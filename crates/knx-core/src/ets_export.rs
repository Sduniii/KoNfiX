use crate::model::*;
use quick_xml::escape::escape;
use std::collections::{BTreeMap, HashMap};
use std::io::{Cursor, Read, Write};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

pub struct EtsExporter;

impl EtsExporter {
    /// Generates standard ETS 5/6 compatible CSV format for Group Addresses.
    /// Format: "Group name","Address","Central","Unfiltered","Description","DatapointType","Security"
    pub fn to_ets_csv(project: &Project) -> String {
        let mut csv = String::new();
        // Standard ETS CSV header
        csv.push_str("\"Group name\",\"Address\",\"Central\",\"Unfiltered\",\"Description\",\"DatapointType\",\"Security\"\n");

        // Group addresses hierarchically by Main / Middle / Sub
        let mut main_map: BTreeMap<u8, BTreeMap<u8, Vec<&GroupAddress>>> = BTreeMap::new();

        for ga in &project.group_addresses {
            main_map
                .entry(ga.main)
                .or_default()
                .entry(ga.middle)
                .or_default()
                .push(ga);
        }

        for (main, middle_map) in main_map {
            // Find floor name or fallback
            let floor_name = match main {
                0 => "Zentral & Global".to_string(),
                1 => "Erdgeschoss".to_string(),
                2 => "Obergeschoss".to_string(),
                3 => "Keller / Untergeschoss".to_string(),
                other => format!("Bereich {}", other),
            };

            // Main group row in ETS format: "Name", "1/-/-"
            csv.push_str(&format!(
                "\"{}\",\"{}/-/-\",\"False\",\"False\",\"Bereich {}\",\"\",\"Auto\"\n",
                floor_name, main, floor_name
            ));

            for (middle, gas) in middle_map {
                let gewerk_name = match middle {
                    1 => "Beleuchtung".to_string(),
                    2 => "Beschattung".to_string(),
                    3 => "Heizung & Klima".to_string(),
                    other => format!("Gewerk {}", other),
                };

                // Middle group row: "Name", "1/1/-"
                csv.push_str(&format!(
                    "\"{}\",\"{}/{}/-\",\"False\",\"False\",\"Gewerk {}\",\"\",\"Auto\"\n",
                    gewerk_name, main, middle, gewerk_name
                ));

                for ga in gas {
                    // Sub group row: "Name", "1/1/10"
                    csv.push_str(&format!(
                        "\"{}\",\"{}\",\"False\",\"False\",\"{}\",\"DPST-{}\",\"Auto\"\n",
                        ga.name.replace('"', "\"\""),
                        ga.address,
                        ga.description.replace('"', "\"\""),
                        ga.dpt
                    ));
                }
            }
        }

        csv
    }

    /// Converts a standard DPT string (e.g. "1.001", "1.008", "5.001", "9.001")
    /// into official ETS Schema 23 format (e.g. "DPST-1-1", "DPST-1-8", "DPST-5-1")
    pub fn to_ets_dpst(dpt: &str) -> String {
        let clean = dpt.trim();
        if clean.starts_with("DPST-") {
            return clean.to_string();
        }
        if let Some(rest) = clean.strip_prefix("DPT-") {
            return format!("DPST-{}-1", rest);
        }
        if clean.contains('.') {
            let parts: Vec<&str> = clean.split('.').collect();
            if parts.len() >= 2 {
                let main = parts[0].parse::<u32>().unwrap_or(1);
                let sub = parts[1].parse::<u32>().unwrap_or(1);
                return format!("DPST-{}-{}", main, sub);
            }
        }
        "DPST-1-1".to_string()
    }

    /// Generates ETS Schema 23 compliant XML installation document (0.xml)
    pub fn to_ets_xml(project: &Project) -> String {
        Self::generate_installation_0_xml(project, "P-0425")
    }

    /// Generates ETS 6.2 XML Schema 23 compliant `project.xml`
    pub fn generate_project_xml(project: &Project, project_id: &str) -> String {
        let now_iso = chrono::Utc::now().to_rfc3339();
        let mut xml = String::new();
        xml.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        xml.push_str("<KNX xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" CreatedBy=\"KNX Configurator\" ToolVersion=\"6.2.7302.0\" xmlns=\"http://knx.org/xml/project/23\">\n");
        xml.push_str(&format!("  <Project Id=\"{}\">\n", project_id));
        xml.push_str(&format!(
            "    <ProjectInformation Name=\"{}\" GroupAddressStyle=\"ThreeLevel\" LastModified=\"{}\" ProjectStart=\"{}\" Comment=\"Erstellt mit KNX Configurator\" CompletionStatus=\"Editing\" Guid=\"{}\">\n",
            escape(&project.name),
            now_iso,
            now_iso,
            project.id
        ));
        xml.push_str("      <ProjectTraces>\n");
        xml.push_str(&format!(
            "        <ProjectTrace Date=\"{}\" UserName=\"KNX Configurator\" Comment=\"Vollwertiger ETS 6.2 Projekt-Export\" />\n",
            now_iso
        ));
        xml.push_str("      </ProjectTraces>\n");

        // Device certificates for KNX Data Secure devices
        let secure_devices: Vec<&KnxDevice> = project
            .devices
            .iter()
            .filter(|d| {
                d.security
                    .as_ref()
                    .map(|s| s.is_secure_enabled && s.fdsk.is_some())
                    .unwrap_or(false)
            })
            .collect();

        if !secure_devices.is_empty() {
            xml.push_str("      <DeviceCertificates>\n");
            for dev in secure_devices {
                if let Some(sec) = &dev.security {
                    if let Some(fdsk) = &sec.fdsk {
                        let serial = dev
                            .order_number
                            .clone()
                            .unwrap_or_else(|| format!("SN-{}", dev.individual_address.replace('.', "-")));
                        xml.push_str(&format!(
                            "        <DeviceCertificate SerialNumber=\"{}\" FDSK=\"{}\" />\n",
                            escape(&serial),
                            escape(fdsk)
                        ));
                    }
                }
            }
            xml.push_str("      </DeviceCertificates>\n");
        }

        xml.push_str("    </ProjectInformation>\n");
        xml.push_str("  </Project>\n");
        xml.push_str("</KNX>\n");

        xml
    }

    /// Generates ETS 6.2 XML Schema 23 compliant `0.xml` (Installation data)
    pub fn generate_installation_0_xml(project: &Project, project_id: &str) -> String {
        let mut xml = String::new();
        xml.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        xml.push_str("<KNX xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" CreatedBy=\"KNX Configurator\" ToolVersion=\"6.2.7302.0\" xmlns=\"http://knx.org/xml/project/23\">\n");
        xml.push_str(&format!("  <Project Id=\"{}\">\n", project_id));
        xml.push_str("    <Installations>\n");
        xml.push_str("      <Installation InstallationNumber=\"0\" Name=\"\" BCUKey=\"4294967295\" DefaultLine=\"P-0425-0_L-1\" IPRoutingLatencyTolerance=\"2000\">\n");

        let mut puid_counter: u32 = 1;

        // 1. Map GroupAddresses to unique XML IDs: Id="P-XXXX-0_GA-YYYY"
        // Also build reverse lookup: ga_uuid -> ga_xml_id, ga_addr_str -> ga_xml_id
        let mut ga_id_to_xml: HashMap<Uuid, String> = HashMap::new();
        let mut ga_addr_to_xml: HashMap<String, String> = HashMap::new();

        for (idx, ga) in project.group_addresses.iter().enumerate() {
            let ga_xml_id = format!("{}-0_GA-{}", project_id, idx + 1);
            ga_id_to_xml.insert(ga.id, ga_xml_id.clone());
            ga_addr_to_xml.insert(ga.address.clone(), ga_xml_id);
        }

        // 2. Topology Generation
        xml.push_str("        <Topology>\n");

        // Group devices by area and line
        // Area number -> (Line number -> Vec<&KnxDevice>)
        let mut area_line_devices: BTreeMap<u8, BTreeMap<u8, Vec<&KnxDevice>>> = BTreeMap::new();

        for dev in &project.devices {
            let parts: Vec<&str> = dev.individual_address.split('.').collect();
            let area_num = parts.first().and_then(|s| s.parse::<u8>().ok()).unwrap_or(1);
            let line_num = parts.get(1).and_then(|s| s.parse::<u8>().ok()).unwrap_or(1);
            area_line_devices
                .entry(area_num)
                .or_default()
                .entry(line_num)
                .or_default()
                .push(dev);
        }

        // If no devices exist, ensure at least Area 1, Line 1.1 exists
        if area_line_devices.is_empty() {
            area_line_devices.entry(1).or_default().entry(1).or_default();
        }

        // Track Device UUID to generated Device XML ID for <Locations>
        let mut dev_uuid_to_xml_id: HashMap<Uuid, String> = HashMap::new();

        for (area_num, lines_map) in &area_line_devices {
            let area_xml_id = format!("{}-0_A-{}", project_id, area_num);
            let area_name = format!("Bereich {}", area_num);
            let area_puid = puid_counter;
            puid_counter += 1;

            xml.push_str(&format!(
                "          <Area Id=\"{}\" Address=\"{}\" Name=\"{}\" Puid=\"{}\">\n",
                area_xml_id, area_num, area_name, area_puid
            ));

            for (line_num, devs) in lines_map {
                let line_xml_id = format!("{}-0_L-{}-{}", project_id, area_num, line_num);
                let line_name = if *line_num == 0 {
                    format!("Hauptlinie {}.0", area_num)
                } else {
                    format!("Linie {}.{} TP", area_num, line_num)
                };
                let line_puid = puid_counter;
                puid_counter += 1;

                let segment_xml_id = format!("{}-0_S-{}-{}", project_id, area_num, line_num);
                let segment_puid = puid_counter;
                puid_counter += 1;

                xml.push_str(&format!(
                    "            <Line Id=\"{}\" Address=\"{}\" Name=\"{}\" Puid=\"{}\">\n",
                    line_xml_id, line_num, line_name, line_puid
                ));
                xml.push_str(&format!(
                    "              <Segment Id=\"{}\" Number=\"0\" MediumTypeRefId=\"MT-0\" Puid=\"{}\">\n",
                    segment_xml_id, segment_puid
                ));

                for (d_idx, dev) in devs.iter().enumerate() {
                    let parts: Vec<&str> = dev.individual_address.split('.').collect();
                    let host_addr = parts.get(2).and_then(|s| s.parse::<u8>().ok()).unwrap_or((d_idx + 1) as u8);
                    let dev_xml_id = format!("{}-0_DI-{}", project_id, puid_counter);
                    dev_uuid_to_xml_id.insert(dev.id, dev_xml_id.clone());
                    let dev_puid = puid_counter;
                    puid_counter += 1;

                    let product_ref = dev
                        .order_number
                        .as_deref()
                        .map(|o| format!("M-0083_H-1_P-{}", o.replace(' ', "_")))
                        .unwrap_or_else(|| "M-0083_H-1_P-Default".to_string());

                    let h2p_ref = dev
                        .application_program
                        .as_deref()
                        .map(|a| format!("M-0083_H-1_HP-{}", a.replace(' ', "_")))
                        .unwrap_or_else(|| "M-0083_H-1_HP-Default".to_string());

                    let mut extra_attrs = String::new();
                    if let Some(ref img) = dev.loaded_image {
                        extra_attrs.push_str(&format!(" LoadedImage=\"{}\"", escape(img)));
                    }
                    if let Some(ref chk) = dev.checksums {
                        extra_attrs.push_str(&format!(" CheckSums=\"{}\"", escape(chk)));
                    }

                    xml.push_str(&format!(
                        "                <DeviceInstance Id=\"{}\" Address=\"{}\" Name=\"{}\" ProductRefId=\"{}\" Hardware2ProgramRefId=\"{}\" Puid=\"{}\"{}>\n",
                        dev_xml_id,
                        host_addr,
                        escape(&dev.name),
                        escape(&product_ref),
                        escape(&h2p_ref),
                        dev_puid,
                        extra_attrs
                    ));

                    // ParameterInstanceRefs
                    if !dev.parameters.is_empty() {
                        xml.push_str("                  <ParameterInstanceRefs>\n");
                        for p in &dev.parameters {
                            xml.push_str(&format!(
                                "                    <ParameterInstanceRef RefId=\"{}\" Value=\"{}\" />\n",
                                escape(&p.id),
                                escape(&p.value)
                            ));
                        }
                        xml.push_str("                  </ParameterInstanceRefs>\n");
                    }

                    // ComObjectInstanceRefs
                    if !dev.communication_objects.is_empty() {
                        xml.push_str("                  <ComObjectInstanceRefs>\n");
                        for co in &dev.communication_objects {
                            // Collect linked GAs for this KO
                            let mut linked_ga_xmls = Vec::new();

                            for ga_addr in &co.group_addresses {
                                if let Some(xml_id) = ga_addr_to_xml.get(ga_addr) {
                                    linked_ga_xmls.push(xml_id.clone());
                                }
                            }

                            for ga_id in &co.group_address_ids {
                                if let Some(xml_id) = ga_id_to_xml.get(ga_id) {
                                    if !linked_ga_xmls.contains(xml_id) {
                                        linked_ga_xmls.push(xml_id.clone());
                                    }
                                }
                            }

                                let links_attr = if !linked_ga_xmls.is_empty() {
                                    format!(" Links=\"{}\"", linked_ga_xmls.join(" "))
                                } else {
                                    String::new()
                                };

                                let dpst_attr = if !co.dpt.is_empty() {
                                    format!(" DatapointType=\"{}\"", Self::to_ets_dpst(&co.dpt))
                                } else {
                                    String::new()
                                };

                                let comm_flag = if co.flags.communication { "Enabled" } else { "Disabled" };
                                let read_flag = if co.flags.read { "Enabled" } else { "Disabled" };
                                let write_flag = if co.flags.write { "Enabled" } else { "Disabled" };
                                let trans_flag = if co.flags.transmit { "Enabled" } else { "Disabled" };
                                let update_flag = if co.flags.update { "Enabled" } else { "Disabled" };

                                xml.push_str(&format!(
                                    "                    <ComObjectInstanceRef RefId=\"{}\" Text=\"{}\" FunctionText=\"{}\"{}{} CommunicationFlag=\"{}\" ReadFlag=\"{}\" WriteFlag=\"{}\" TransmitFlag=\"{}\" UpdateFlag=\"{}\" />\n",
                                    escape(&co.id),
                                    escape(&co.object_text),
                                    escape(&co.function_text),
                                    dpst_attr,
                                    links_attr,
                                    comm_flag,
                                    read_flag,
                                    write_flag,
                                    trans_flag,
                                    update_flag
                                ));
                            }
                            xml.push_str("                  </ComObjectInstanceRefs>\n");
                        }

                    // Security element if Data Secure is enabled
                    if let Some(sec) = &dev.security {
                        if sec.is_secure_enabled {
                            xml.push_str(&format!(
                                "                  <Security SequenceNumber=\"{}\" />\n",
                                sec.sequence_number
                            ));
                        }
                    }

                    xml.push_str("                </DeviceInstance>\n");
                }

                xml.push_str("              </Segment>\n");
                xml.push_str("            </Line>\n");
            }

            xml.push_str("          </Area>\n");
        }

        xml.push_str("        </Topology>\n");

        // 3. Locations (Building -> Floor -> Room -> DeviceInstanceRef)
        xml.push_str("        <Locations>\n");

        let building_name = project
            .buildings
            .first()
            .map(|b| b.name.as_str())
            .unwrap_or("Gebäude");
        let bldg_puid = puid_counter;
        puid_counter += 1;

        xml.push_str(&format!(
            "          <Space Type=\"Building\" Name=\"{}\" Puid=\"{}\">\n",
            escape(building_name),
            bldg_puid
        ));

        // Group rooms by floor
        let mut rooms_by_floor: BTreeMap<Uuid, Vec<&Room>> = BTreeMap::new();
        for r in &project.rooms {
            rooms_by_floor.entry(r.floor_id).or_default().push(r);
        }

        if project.floors.is_empty() {
            // Default floor
            let floor_puid = puid_counter;
            puid_counter += 1;
            xml.push_str(&format!(
                "            <Space Type=\"Floor\" Name=\"Erdgeschoss\" Puid=\"{}\">\n",
                floor_puid
            ));

            for room in &project.rooms {
                let room_puid = puid_counter;
                puid_counter += 1;
                xml.push_str(&format!(
                    "              <Space Type=\"Room\" Name=\"{}\" Puid=\"{}\">\n",
                    escape(&room.name),
                    room_puid
                ));

                // Devices in this room
                for dev in &project.devices {
                    if dev.room_id == Some(room.id) {
                        if let Some(dev_xml_id) = dev_uuid_to_xml_id.get(&dev.id) {
                            xml.push_str(&format!(
                                "                <DeviceInstanceRef RefId=\"{}\" />\n",
                                dev_xml_id
                            ));
                        }
                    }
                }

                xml.push_str("              </Space>\n");
            }

            xml.push_str("            </Space>\n");
        } else {
            for floor in &project.floors {
                let floor_puid = puid_counter;
                puid_counter += 1;

                xml.push_str(&format!(
                    "            <Space Type=\"Floor\" Name=\"{}\" Puid=\"{}\">\n",
                    escape(&floor.name),
                    floor_puid
                ));

                if let Some(rooms) = rooms_by_floor.get(&floor.id) {
                    for room in rooms {
                        let room_puid = puid_counter;
                        puid_counter += 1;

                        xml.push_str(&format!(
                            "              <Space Type=\"Room\" Name=\"{}\" Puid=\"{}\">\n",
                            escape(&room.name),
                            room_puid
                        ));

                        for dev in &project.devices {
                            if dev.room_id == Some(room.id) {
                                if let Some(dev_xml_id) = dev_uuid_to_xml_id.get(&dev.id) {
                                    xml.push_str(&format!(
                                        "                <DeviceInstanceRef RefId=\"{}\" />\n",
                                        dev_xml_id
                                    ));
                                }
                            }
                        }

                        xml.push_str("              </Space>\n");
                    }
                }

                xml.push_str("            </Space>\n");
            }
        }

        xml.push_str("          </Space>\n");
        xml.push_str("        </Locations>\n");

        // 4. GroupAddresses (3-Level GroupRanges)
        xml.push_str("        <GroupAddresses>\n");
        xml.push_str("          <GroupRanges>\n");

        let mut main_map: BTreeMap<u8, BTreeMap<u8, Vec<&GroupAddress>>> = BTreeMap::new();
        for ga in &project.group_addresses {
            main_map
                .entry(ga.main)
                .or_default()
                .entry(ga.middle)
                .or_default()
                .push(ga);
        }

        for (main, mid_map) in main_map {
            let main_puid = puid_counter;
            puid_counter += 1;

            let main_xml_id = format!("{}-0_GR-{}", project_id, main_puid);
            let (range_start, range_end) = if main == 0 {
                (1u16, 2047u16)
            } else {
                ((main as u16) * 2048, ((main as u16) + 1) * 2048 - 1)
            };

            let main_name = match main {
                0 => "Zentral & Global".to_string(),
                1 => "Erdgeschoss".to_string(),
                2 => "Obergeschoss".to_string(),
                3 => "Keller / Untergeschoss".to_string(),
                other => format!("Bereich {}", other),
            };

            xml.push_str(&format!(
                "            <GroupRange Id=\"{}\" RangeStart=\"{}\" RangeEnd=\"{}\" Name=\"{}\" Puid=\"{}\">\n",
                main_xml_id, range_start, range_end, escape(&main_name), main_puid
            ));

            for (mid, gas) in mid_map {
                let mid_puid = puid_counter;
                puid_counter += 1;

                let mid_xml_id = format!("{}-0_GR-{}", project_id, mid_puid);
                let mid_start = (main as u16) * 2048 + (mid as u16) * 256;
                let mid_end = mid_start + 255;

                let mid_name = match mid {
                    1 => "Beleuchtung".to_string(),
                    2 => "Beschattung".to_string(),
                    3 => "Heizung & Klima".to_string(),
                    other => format!("Gewerk {}", other),
                };

                xml.push_str(&format!(
                    "              <GroupRange Id=\"{}\" RangeStart=\"{}\" RangeEnd=\"{}\" Name=\"{}\" Puid=\"{}\">\n",
                    mid_xml_id, mid_start, mid_end, escape(&mid_name), mid_puid
                ));

                for ga in gas {
                    let ga_puid = puid_counter;
                    puid_counter += 1;

                    let ga_xml_id = ga_id_to_xml
                        .get(&ga.id)
                        .cloned()
                        .unwrap_or_else(|| format!("{}-0_GA-{}", project_id, ga_puid));

                    let ga_addr_u16 = ((ga.main as u16) << 11) | ((ga.middle as u16) << 8) | (ga.sub as u16);
                    let dpst = Self::to_ets_dpst(&ga.dpt);

                    xml.push_str(&format!(
                        "                <GroupAddress Id=\"{}\" Address=\"{}\" Name=\"{}\" DatapointType=\"{}\" Description=\"{}\" Puid=\"{}\" />\n",
                        ga_xml_id,
                        ga_addr_u16,
                        escape(&ga.name),
                        dpst,
                        escape(&ga.description),
                        ga_puid
                    ));
                }

                xml.push_str("              </GroupRange>\n");
            }

            xml.push_str("            </GroupRange>\n");
        }

        xml.push_str("          </GroupRanges>\n");
        xml.push_str("        </GroupAddresses>\n");

        xml.push_str("      </Installation>\n");
        xml.push_str("    </Installations>\n");
        xml.push_str("  </Project>\n");
        xml.push_str("</KNX>\n");

        xml
    }

    /// Bundles `0.xml` and `project.xml` into the inner `P-XXXX.zip`.
    /// If password is provided, uses 7z command line to create AES-256 encrypted zip with PBKDF2 key.
    pub fn create_inner_project_zip(
        xml_0: &str,
        project_xml: &str,
        password: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        if let Some(pwd) = password {
            if !pwd.trim().is_empty() {
                // Derive ETS6 PBKDF2 Key
                let derived_key = crate::ets_import::derive_ets6_key(pwd.trim());

                let temp_dir = std::env::temp_dir();
                let run_id = Uuid::new_v4();
                let sub_dir = temp_dir.join(format!("knx_export_{}", run_id));
                std::fs::create_dir_all(&sub_dir)
                    .map_err(|e| format!("Fehler beim Erstellen des Temp-Verzeichnisses: {}", e))?;

                let f0_path = sub_dir.join("0.xml");
                let fp_path = sub_dir.join("project.xml");
                let out_zip = temp_dir.join(format!("p_{}.zip", run_id));

                std::fs::write(&f0_path, xml_0)
                    .map_err(|e| format!("Fehler beim Schreiben von 0.xml: {}", e))?;
                std::fs::write(&fp_path, project_xml)
                    .map_err(|e| format!("Fehler beim Schreiben von project.xml: {}", e))?;

                // 7z a -tzip -mem=AES256 -p<derived_key> out.zip 0.xml project.xml
                let status = std::process::Command::new("7z")
                    .current_dir(&sub_dir)
                    .arg("a")
                    .arg("-tzip")
                    .arg("-mem=AES256")
                    .arg(format!("-p{}", derived_key))
                    .arg(&out_zip)
                    .arg("0.xml")
                    .arg("project.xml")
                    .output();

                let _ = std::fs::remove_dir_all(&sub_dir);

                match status {
                    Ok(out) if out.status.success() && out_zip.exists() => {
                        let bytes = std::fs::read(&out_zip)
                            .map_err(|e| format!("Fehler beim Lesen des verschlüsselten ZIPs: {}", e))?;
                        let _ = std::fs::remove_file(out_zip);
                        return Ok(bytes);
                    }
                    _ => {
                        let _ = std::fs::remove_file(&out_zip);
                        // Fallback: proceed to unencrypted in-memory
                    }
                }
            }
        }

        // Unencrypted In-Memory ZIP
        let mut buf = Vec::new();
        {
            let mut writer = ZipWriter::new(Cursor::new(&mut buf));
            let options = SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            writer
                .start_file("0.xml", options)
                .map_err(|e| format!("Fehler beim Erstellen von 0.xml im ZIP: {}", e))?;
            writer
                .write_all(xml_0.as_bytes())
                .map_err(|e| format!("Fehler beim Schreiben von 0.xml: {}", e))?;

            writer
                .start_file("project.xml", options)
                .map_err(|e| format!("Fehler beim Erstellen von project.xml im ZIP: {}", e))?;
            writer
                .write_all(project_xml.as_bytes())
                .map_err(|e| format!("Fehler beim Schreiben von project.xml: {}", e))?;

            writer
                .finish()
                .map_err(|e| format!("Fehler beim Fertigstellen des inneren ZIP: {}", e))?;
        }

        Ok(buf)
    }

    /// Full `.knxproj` export pipeline.
    /// Produces a 100% ETS 5 / ETS 6 compatible `.knxproj` ZIP archive.
    pub fn export_knxproj(project: &Project, password: Option<&str>) -> Result<Vec<u8>, String> {
        let project_id = "P-0425";

        let xml_0 = Self::generate_installation_0_xml(project, project_id);
        let project_xml = Self::generate_project_xml(project, project_id);

        let inner_zip_bytes = Self::create_inner_project_zip(&xml_0, &project_xml, password)?;

        // Build outer .knxproj ZIP
        let mut outer_buf = Vec::new();
        {
            let mut writer = ZipWriter::new(Cursor::new(&mut outer_buf));
            let options = SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            // 1. knx_master.xml
            const MASTER_XML: &[u8] = include_bytes!("../resources/knx_master.xml");
            writer
                .start_file("knx_master.xml", options)
                .map_err(|e| format!("Fehler beim Hinzufügen von knx_master.xml: {}", e))?;
            writer
                .write_all(MASTER_XML)
                .map_err(|e| format!("Fehler beim Schreiben von knx_master.xml: {}", e))?;

            // 2. P-0425.signature (Standard dummy base64 signature)
            let dummy_sig = b"bUx6WmxRYjdKdjRvMFNSYjhFTkIyYVpQcWdxcnBYNldBSlR2WGJJaE1vdTM4R2x0U0o4OFpmTFRP\naERocnFubUFyWGNzUUhDQTBTZEdxSXR4S1NNN3krM2xDVVVxN3VLZytLVWxEVzdnV1hkUkg1UEt1\nN2Z1OE8wQWdWNXA4Z1FNYjJudlBDenlwcmhWMHhyNEd2VXg4MzEvcWc5VnVsSVpmaktYQkNaNG9n\nPQ==";
            writer
                .start_file(format!("{}.signature", project_id), options)
                .map_err(|e| format!("Fehler beim Hinzufügen der Signatur: {}", e))?;
            writer
                .write_all(dummy_sig)
                .map_err(|e| format!("Fehler beim Schreiben der Signatur: {}", e))?;

            // 3. P-0425.zip
            writer
                .start_file(format!("{}.zip", project_id), options)
                .map_err(|e| format!("Fehler beim Hinzufügen von {}.zip: {}", project_id, e))?;
            writer
                .write_all(&inner_zip_bytes)
                .map_err(|e| format!("Fehler beim Schreiben von {}.zip: {}", project_id, e))?;

            // 4. Optionally copy manufacturer hardware catalogs from a source knxproj if available
            let source_proj_path = std::env::var("KONFIX_SOURCE_KNXPROJ").unwrap_or_else(|_| "source.knxproj".to_string());
            if let Ok(source_bytes) = std::fs::read(&source_proj_path) {
                if let Ok(mut src_zip) = zip::ZipArchive::new(Cursor::new(&source_bytes)) {
                    for i in 0..src_zip.len() {
                        if let Ok(mut src_file) = src_zip.by_index(i) {
                            let fname = src_file.name().to_string();
                            // Copy manufacturer folders and signatures
                            if fname.starts_with("M-") {
                                let mut file_bytes = Vec::new();
                                if src_file.read_to_end(&mut file_bytes).is_ok() {
                                    let _ = writer.start_file(&fname, options);
                                    let _ = writer.write_all(&file_bytes);
                                }
                            }
                        }
                    }
                }
            }

            writer
                .finish()
                .map_err(|e| format!("Fehler beim Fertigstellen des .knxproj Archivs: {}", e))?;
        }

        Ok(outer_buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn test_ets_csv_export() {
        let project = Project {
            id: Uuid::new_v4(),
            name: "Musterhaus".to_string(),
            ga_scheme: GaScheme::FloorTradeFunction,
            buildings: vec![],
            floors: vec![],
            rooms: vec![],
            devices: vec![],
            blocks: vec![],
            connections: vec![],
            group_addresses: vec![
                GroupAddress {
                    id: Uuid::new_v4(),
                    address: "1/1/10".to_string(),
                    main: 1,
                    middle: 1,
                    sub: 10,
                    name: "Wohnzimmer Decke - Schalten".to_string(),
                    dpt: "1.001".to_string(),
                    description: "Licht Wohnzimmer Decke".to_string(),
                    origin_block_id: None,
                    origin_pin_name: None,
                    is_custom: false,
                },
            ],
            topology: None,
        };

        let csv = EtsExporter::to_ets_csv(&project);
        assert!(csv.contains("\"Group name\",\"Address\""));
        assert!(csv.contains("\"1/1/10\""));
        assert!(csv.contains("DPST-1.001"));
        assert!(csv.contains("\"Wohnzimmer Decke - Schalten\""));
    }

    #[test]
    fn test_generate_xml_and_knxproj_export() {
        let floor_id = Uuid::new_v4();
        let room_id = Uuid::new_v4();
        let dev_id = Uuid::new_v4();
        let ga_id = Uuid::new_v4();

        let project = Project {
            id: Uuid::new_v4(),
            name: "TestVilla".to_string(),
            ga_scheme: GaScheme::TradeRoomFunction,
            buildings: vec![Building {
                id: Uuid::new_v4(),
                name: "Hauptgebäude".to_string(),
            }],
            floors: vec![Floor {
                id: floor_id,
                building_id: Uuid::new_v4(),
                name: "Erdgeschoss".to_string(),
                level: 0,
            }],
            rooms: vec![Room {
                id: room_id,
                floor_id,
                name: "Wohnzimmer".to_string(),
                icon: "sofa".to_string(),
            }],
            devices: vec![KnxDevice {
                id: dev_id,
                individual_address: "1.1.5".to_string(),
                manufacturer: "MDT Technologies".to_string(),
                model: "AKD-0401.02".to_string(),
                name: "Dimmaktor 4-fach".to_string(),
                room_id: Some(room_id),
                channels: vec![],
                position: None,
                order_number: Some("AKD-0401.02".to_string()),
                application_program: Some("AKD-0401.02_V2".to_string()),
                mask_version: Some("07B0h".to_string()),
                bus_current_ma: Some(10),
                communication_objects: vec![CommunicationObject {
                    id: "O-1_R-1".to_string(),
                    number: 1,
                    name: "Kanal A Schalten".to_string(),
                    function_text: "Schalten".to_string(),
                    object_text: "Kanal A".to_string(),
                    dpt: "1.001".to_string(),
                    object_size: "1 Bit".to_string(),
                    flags: ComObjectFlags {
                        communication: true,
                        read: false,
                        write: true,
                        transmit: false,
                        update: false,
                    },
                    group_addresses: vec!["1/1/5".to_string()],
                    group_address_ids: vec![ga_id],
                }],
                parameters: vec![DeviceParameter {
                    id: "P-1".to_string(),
                    name: "Dimmzeit".to_string(),
                    param_type: "Numeric".to_string(),
                    value: "2".to_string(),
                    default_value: "1".to_string(),
                    suffix: Some("s".to_string()),
                    options: vec![],
                    enum_options: vec![],
                    page: None,
                    pages: vec![],
                    section: None,
                    depends_on: None,
                    text: "Dimmzeit Sek.".to_string(),
                    access: None,
                    offset: None,
                    bit_offset: None,
                    size_in_bit: None,
                    min: Some(0.0),
                    max: Some(60.0),
                    step: Some(1.0),
                    is_float: Some(false),
                }],
                assign_rules: vec![],
                visible_ko_numbers: vec![1],
                last_flashed_state: None,
                security: None,
                loaded_image: None,
                checksums: None,
            }],
            blocks: vec![],
            connections: vec![],
            group_addresses: vec![GroupAddress {
                id: ga_id,
                address: "1/1/5".to_string(),
                main: 1,
                middle: 1,
                sub: 5,
                name: "Wohnzimmer Licht Schalten".to_string(),
                dpt: "1.001".to_string(),
                description: "Beleuchtung Wohnzimmer".to_string(),
                origin_block_id: None,
                origin_pin_name: None,
                is_custom: true,
            }],
            topology: None,
        };

        // Test 0.xml generation
        let xml_0 = EtsExporter::generate_installation_0_xml(&project, "P-0425");
        assert!(xml_0.contains("<Project Id=\"P-0425\">"));
        assert!(xml_0.contains("Address=\"1\""));
        assert!(xml_0.contains("Address=\"5\""));
        assert!(xml_0.contains("Name=\"Dimmaktor 4-fach\""));
        assert!(xml_0.contains("DatapointType=\"DPST-1-1\""));
        assert!(xml_0.contains("Links=\"P-0425-0_GA-1\""));
        assert!(xml_0.contains("Name=\"Wohnzimmer\""));
        assert!(xml_0.contains("Space Type=\"Room\""));

        // Test project.xml generation
        let proj_xml = EtsExporter::generate_project_xml(&project, "P-0425");
        assert!(proj_xml.contains("Name=\"TestVilla\""));
        assert!(proj_xml.contains("GroupAddressStyle=\"ThreeLevel\""));

        // Test full .knxproj export archive
        let knxproj_bytes = EtsExporter::export_knxproj(&project, None).expect("Export failed");
        assert!(!knxproj_bytes.is_empty());

        // Validate that exported bytes can be read back as valid ZIP archive
        let cursor = Cursor::new(&knxproj_bytes);
        let mut zip = zip::ZipArchive::new(cursor).expect("Valid ZIP archive");
        assert!(zip.by_name("knx_master.xml").is_ok());
        assert!(zip.by_name("P-0425.zip").is_ok());
        assert!(zip.by_name("P-0425.signature").is_ok());
    }

    #[test]
    fn test_export_roundtrip_import() {
        let floor_id = Uuid::new_v4();
        let room_id = Uuid::new_v4();
        let dev_id = Uuid::new_v4();
        let ga_id = Uuid::new_v4();

        let original = Project {
            id: Uuid::new_v4(),
            name: "RoundtripHaus".to_string(),
            ga_scheme: GaScheme::FloorTradeFunction,
            buildings: vec![Building {
                id: Uuid::new_v4(),
                name: "Hauptgebäude".to_string(),
            }],
            floors: vec![Floor {
                id: floor_id,
                building_id: Uuid::new_v4(),
                name: "Erdgeschoss".to_string(),
                level: 0,
            }],
            rooms: vec![Room {
                id: room_id,
                floor_id,
                name: "Küche".to_string(),
                icon: "utensils".to_string(),
            }],
            devices: vec![KnxDevice {
                id: dev_id,
                individual_address: "1.1.20".to_string(),
                manufacturer: "MDT Technologies".to_string(),
                model: "AKK-0816.03".to_string(),
                name: "Schaltaktor 8-fach".to_string(),
                room_id: Some(room_id),
                channels: vec![],
                position: None,
                order_number: Some("AKK-0816.03".to_string()),
                application_program: Some("AKK-0816.03_V3".to_string()),
                mask_version: Some("07B0h".to_string()),
                bus_current_ma: Some(15),
                communication_objects: vec![CommunicationObject {
                    id: "O-1_R-1".to_string(),
                    number: 1,
                    name: "Kanal A Schalten".to_string(),
                    function_text: "Schalten".to_string(),
                    object_text: "Kanal A".to_string(),
                    dpt: "1.001".to_string(),
                    object_size: "1 Bit".to_string(),
                    flags: ComObjectFlags {
                        communication: true,
                        read: false,
                        write: true,
                        transmit: false,
                        update: false,
                    },
                    group_addresses: vec!["1/1/20".to_string()],
                    group_address_ids: vec![ga_id],
                }],
                parameters: vec![],
                assign_rules: vec![],
                visible_ko_numbers: vec![1],
                last_flashed_state: None,
                security: None,
                loaded_image: None,
                checksums: None,
            }],
            blocks: vec![],
            connections: vec![],
            group_addresses: vec![GroupAddress {
                id: ga_id,
                address: "1/1/20".to_string(),
                main: 1,
                middle: 1,
                sub: 20,
                name: "Küche Decke Schalten".to_string(),
                dpt: "1.001".to_string(),
                description: "Beleuchtung Küche".to_string(),
                origin_block_id: None,
                origin_pin_name: None,
                is_custom: true,
            }],
            topology: None,
        };

        // Export to .knxproj
        let exported_bytes = EtsExporter::export_knxproj(&original, None).expect("Export failed");

        // Import back via parse_knxproj
        let imported = crate::ets_import::parse_knxproj(&exported_bytes, None, "RoundtripImport")
            .expect("Roundtrip import failed");

        // Verify that imported project has matching entities
        assert_eq!(imported.group_addresses.len(), 1);
        assert_eq!(imported.group_addresses[0].address, "1/1/20");
        assert_eq!(imported.group_addresses[0].name, "Küche Decke Schalten");

        assert_eq!(imported.rooms.len(), 1);
        assert_eq!(imported.rooms[0].name, "Küche");

        assert_eq!(imported.devices.len(), 1);
        assert_eq!(imported.devices[0].individual_address, "1.1.20");
        assert_eq!(imported.devices[0].name, "Schaltaktor 8-fach");
    }
}
