use knx_core::ets_export::EtsExporter;
use knx_core::ets_import::parse_knxproj;

fn get_test_knxproj_bytes() -> Option<Vec<u8>> {
    if let Ok(env_path) = std::env::var("KONFIX_TEST_KNXPROJ") {
        if let Ok(bytes) = std::fs::read(&env_path) {
            return Some(bytes);
        }
    }
    let default_path = "/home/tsdun/Nextcloud/Hausbau/Programme/marienthal_new_test.knxproj";
    if std::path::Path::new(default_path).exists() {
        if let Ok(bytes) = std::fs::read(default_path) {
            return Some(bytes);
        }
    }
    None
}

#[test]
fn test_marienthal_import_and_export() {
    let bytes = match get_test_knxproj_bytes() {
        Some(b) => b,
        None => {
            eprintln!("Skipping test_marienthal_import_and_export: test .knxproj not found (set KONFIX_TEST_KNXPROJ).");
            return;
        }
    };
    
    // Import
    let project = parse_knxproj(&bytes, Some("test"), "marienthal_test")
        .expect("Import failed");
    
    println!("Imported project: name='{}', GAs={}, devices={}, rooms={}", 
        project.name, project.group_addresses.len(), project.devices.len(), project.rooms.len());
    
    assert!(!project.group_addresses.is_empty(), "GAs should not be empty");
    assert!(!project.devices.is_empty(), "Devices should not be empty");
    
    // Export with password "test"
    let exported_bytes = EtsExporter::export_knxproj(&project, Some("test"))
        .expect("Export failed");
    
    // Re-import exported project
    let reimported = parse_knxproj(&exported_bytes, Some("test"), "marienthal_reimported")
        .expect("Re-importing exported .knxproj failed");

    println!("Re-imported project: name='{}', GAs={}, devices={}, rooms={}",
        reimported.name, reimported.group_addresses.len(), reimported.devices.len(), reimported.rooms.len());

    assert_eq!(reimported.group_addresses.len(), project.group_addresses.len(), "GA count must match");
    assert_eq!(reimported.devices.len(), project.devices.len(), "Device count must match");
    assert_eq!(reimported.rooms.len(), project.rooms.len(), "Room count must match");
    assert_eq!(reimported.ets_project_id.as_deref(), Some("P-0645"), "Project ID must be P-0645");

    println!("Successfully exported {} bytes to /tmp/konfix_marienthal_export.knxproj and verified complete roundtrip!", exported_bytes.len());
}

#[test]
fn test_marienthal_unencrypted_export_and_reexport_comparison() {
    use std::io::Read;

    let bytes = match get_test_knxproj_bytes() {
        Some(b) => b,
        None => {
            eprintln!("Skipping test_marienthal_unencrypted_export_and_reexport_comparison: test .knxproj not found (set KONFIX_TEST_KNXPROJ).");
            return;
        }
    };

    // Step 1: Initial import from reference knxproj
    let project_orig = parse_knxproj(&bytes, Some("test"), "marienthal_initial")
        .expect("Initial import failed");

    // Step 2: Export 1 without password (unencrypted)
    let exported_1 = EtsExporter::export_knxproj(&project_orig, None)
        .expect("Export 1 without password failed");
    std::fs::write("/tmp/konfix_unencrypted_1.knxproj", &exported_1)
        .expect("Failed to write /tmp/konfix_unencrypted_1.knxproj");

    println!("Export 1 (unencrypted) size: {} bytes", exported_1.len());

    // Step 3: Re-import Export 1 without password
    let project_reimported = parse_knxproj(&exported_1, None, "marienthal_reimported_unencrypted")
        .expect("Re-importing unencrypted Export 1 failed");

    assert_eq!(project_reimported.group_addresses.len(), 436, "All 436 GAs must be present");
    assert_eq!(project_reimported.devices.len(), 15, "All 15 devices must be present");
    assert_eq!(project_reimported.rooms.len(), 6, "All 6 rooms must be present");
    assert_eq!(project_reimported.ets_project_id.as_deref(), Some("P-0645"));

    // Step 4: Export 2 without password (re-export of re-imported)
    let exported_2 = EtsExporter::export_knxproj(&project_reimported, None)
        .expect("Export 2 without password failed");
    std::fs::write("/tmp/konfix_unencrypted_2.knxproj", &exported_2)
        .expect("Failed to write /tmp/konfix_unencrypted_2.knxproj");

    println!("Export 2 (unencrypted) size: {} bytes", exported_2.len());

    // Step 5: Extract and compare 0.xml and project.xml from Export 1 and Export 2
    let mut zip_1 = zip::ZipArchive::new(std::io::Cursor::new(&exported_1)).unwrap();
    let mut zip_2 = zip::ZipArchive::new(std::io::Cursor::new(&exported_2)).unwrap();

    assert_eq!(zip_1.len(), zip_2.len(), "File count in both archives must be identical (71)");

    let mut inner_p_zip_1_bytes = Vec::new();
    zip_1.by_name("P-0645.zip").unwrap().read_to_end(&mut inner_p_zip_1_bytes).unwrap();
    let mut inner_1 = zip::ZipArchive::new(std::io::Cursor::new(&inner_p_zip_1_bytes)).unwrap();

    let mut inner_p_zip_2_bytes = Vec::new();
    zip_2.by_name("P-0645.zip").unwrap().read_to_end(&mut inner_p_zip_2_bytes).unwrap();
    let mut inner_2 = zip::ZipArchive::new(std::io::Cursor::new(&inner_p_zip_2_bytes)).unwrap();

    let mut xml_0_1 = String::new();
    inner_1.by_name("0.xml").unwrap().read_to_string(&mut xml_0_1).unwrap();

    let mut xml_0_2 = String::new();
    inner_2.by_name("0.xml").unwrap().read_to_string(&mut xml_0_2).unwrap();

    // Verify 0.xml contents match
    assert_eq!(xml_0_1.len(), xml_0_2.len(), "0.xml size must be identical between Export 1 and Export 2");
    assert_eq!(xml_0_1, xml_0_2, "0.xml must be 100% identical between Export 1 and Export 2");

    println!("0.xml identical comparison: SUCCESS ({} characters)", xml_0_1.len());

    // Verify project.xml contents match (excluding dynamic UTC export timestamps)
    let mut px_1 = String::new();
    inner_1.by_name("project.xml").unwrap().read_to_string(&mut px_1).unwrap();
    let mut px_2 = String::new();
    inner_2.by_name("project.xml").unwrap().read_to_string(&mut px_2).unwrap();

    let normalize_project_xml = |s: &str| -> String {
        s.lines()
            .map(|l| {
                if l.contains("<ProjectInformation") {
                    l.split_whitespace()
                        .filter(|token| !token.starts_with("LastModified=") && !token.starts_with("ProjectStart="))
                        .collect::<Vec<_>>()
                        .join(" ")
                } else {
                    l.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let px_1_clean = normalize_project_xml(&px_1);
    let px_2_clean = normalize_project_xml(&px_2);

    assert_eq!(px_1_clean, px_2_clean, "project.xml (excluding timestamp) must be 100% identical between Export 1 and Export 2");
    println!("project.xml identical comparison: SUCCESS ({} characters)", px_1.len());
}
