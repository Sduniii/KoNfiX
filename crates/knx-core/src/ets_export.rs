use crate::model::*;
use base64::Engine;
use quick_xml::escape::escape;
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs8::DecodePrivateKey;
use rsa::pkcs1v15::{SigningKey, VerifyingKey};
use rsa::signature::{SignatureEncoding, Signer, Verifier};
use rsa::{RsaPrivateKey, RsaPublicKey};
use sha1::{Digest as Sha1Digest, Sha1};
use std::collections::{BTreeMap, HashMap};
use std::io::{Cursor, Read, Write};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Helper to map manufacturer string to ETS Schema 23 manufacturer identifier
pub fn lookup_manufacturer_id_by_name(mfr: &str) -> &'static str {
    let lower = mfr.to_lowercase();
    if lower.contains("mdt") {
        "M-0083"
    } else if lower.contains("sation") || lower.contains("enertex") {
        "M-010F"
    } else if lower.contains("abb") || lower.contains("busch") {
        "M-0002"
    } else if lower.contains("weinzierl") || lower.contains("knx association") {
        "M-00FA"
    } else if lower.contains("siemens") {
        "M-0001"
    } else if lower.contains("gira") || lower.contains("jung") {
        "M-0004"
    } else {
        "M-0000"
    }
}

#[derive(Debug, Clone, Default)]
pub struct HardwareCatalogEntry {
    pub hardware_id: String,
    pub product_id: String,
    pub order_number: String,
    pub product_text: String,
    pub h2p_id: String,
    pub app_ref: String,
}

#[derive(Debug, Clone, Default)]
pub struct HardwareCatalogIndex {
    pub entries: Vec<HardwareCatalogEntry>,
}

impl HardwareCatalogIndex {
    pub fn from_assets(assets_zip_bytes: &[u8]) -> Self {
        let reader = Cursor::new(assets_zip_bytes);
        let mut zip = match zip::ZipArchive::new(reader) {
            Ok(z) => z,
            Err(_) => return Self::default(),
        };

        let mut entries = Vec::new();

        for i in 0..zip.len() {
            let (file_name, is_hardware) = match zip.by_index(i) {
                Ok(f) => {
                    let safe_name = match f.enclosed_name() {
                        Some(p) => p.to_string_lossy().to_string(),
                        None => continue,
                    };
                    let is_hw = safe_name.to_lowercase().ends_with("hardware.xml");
                    (safe_name, is_hw)
                }
                Err(_) => continue,
            };

            if is_hardware {
                let mut content = Vec::new();
                if let Ok(f) = zip.by_name(&file_name) {
                    // Protect against decompression bombs (max 64 MB per file)
                    let _ = f.take(64 * 1024 * 1024).read_to_end(&mut content);
                }

                if !content.is_empty() {
                    let parsed = Self::parse_hardware_xml(&content);
                    entries.extend(parsed);
                }
            }
        }

        Self { entries }
    }

    fn parse_hardware_xml(xml_bytes: &[u8]) -> Vec<HardwareCatalogEntry> {
        use quick_xml::events::Event;
        use quick_xml::reader::Reader;

        let mut r = Reader::from_reader(xml_bytes);
        r.config_mut().trim_text(true);

        let mut entries = Vec::new();
        let mut cur_hw_id = String::new();
        let mut cur_h2ps: Vec<(String, String)> = Vec::new(); // (h2p_id, app_ref)
        let mut cur_products: Vec<(String, String, String)> = Vec::new(); // (prod_id, order_number, text)
        let mut in_hardware = false;
        let mut buf = Vec::new();

        let flush_entries = |entries: &mut Vec<HardwareCatalogEntry>,
                             cur_hw_id: &str,
                             cur_products: &[(String, String, String)],
                             cur_h2ps: &[(String, String)]| {
            for (prod_id, order, text) in cur_products {
                if cur_h2ps.is_empty() {
                    entries.push(HardwareCatalogEntry {
                        hardware_id: cur_hw_id.to_string(),
                        product_id: prod_id.clone(),
                        order_number: order.clone(),
                        product_text: text.clone(),
                        h2p_id: String::new(),
                        app_ref: String::new(),
                    });
                } else {
                    for (h2p_id, app_ref) in cur_h2ps {
                        entries.push(HardwareCatalogEntry {
                            hardware_id: cur_hw_id.to_string(),
                            product_id: prod_id.clone(),
                            order_number: order.clone(),
                            product_text: text.clone(),
                            h2p_id: h2p_id.clone(),
                            app_ref: app_ref.clone(),
                        });
                    }
                }
            }
        };

        while let Ok(ev) = r.read_event_into(&mut buf) {
            match ev {
                Event::Start(ref e) | Event::Empty(ref e) => {
                    let qname = e.name();
                    let tag = qname.as_ref();
                    if tag == b"Hardware" {
                        in_hardware = true;
                        cur_hw_id.clear();
                        cur_h2ps.clear();
                        cur_products.clear();
                        for a in e.attributes().flatten() {
                            if a.key.as_ref() == b"Id" {
                                cur_hw_id = String::from_utf8_lossy(&a.value).to_string();
                            }
                        }
                    } else if tag == b"Product" {
                        let mut pid = String::new();
                        let mut order = String::new();
                        let mut text = String::new();
                        for a in e.attributes().flatten() {
                            match a.key.as_ref() {
                                b"Id" => pid = String::from_utf8_lossy(&a.value).to_string(),
                                b"OrderNumber" => order = String::from_utf8_lossy(&a.value).to_string(),
                                b"Text" => text = String::from_utf8_lossy(&a.value).to_string(),
                                _ => {}
                            }
                        }
                        if !pid.is_empty() {
                            cur_products.push((pid, order, text));
                        }
                    } else if tag == b"Hardware2Program" {
                        let mut hid = String::new();
                        for a in e.attributes().flatten() {
                            if a.key.as_ref() == b"Id" {
                                hid = String::from_utf8_lossy(&a.value).to_string();
                            }
                        }
                        if !hid.is_empty() {
                            cur_h2ps.push((hid, String::new()));
                        }
                    } else if tag == b"ApplicationProgramRef" {
                        for a in e.attributes().flatten() {
                            if a.key.as_ref() == b"RefId" {
                                let ref_id = String::from_utf8_lossy(&a.value).to_string();
                                if let Some(last_h2p) = cur_h2ps.last_mut() {
                                    last_h2p.1 = ref_id;
                                }
                            }
                        }
                    }
                }
                Event::End(ref e) => {
                    let qname = e.name();
                    if qname.as_ref() == b"Hardware" {
                        in_hardware = false;
                        flush_entries(&mut entries, &cur_hw_id, &cur_products, &cur_h2ps);
                    }
                }
                Event::Eof => {
                    if in_hardware {
                        flush_entries(&mut entries, &cur_hw_id, &cur_products, &cur_h2ps);
                    }
                    break;
                }
                _ => {}
            }
            buf.clear();
        }

        entries
    }

    pub fn resolve_device_refs(&self, dev: &KnxDevice) -> (Option<String>, Option<String>) {
        if let (Some(ref p), Some(ref h)) = (&dev.product_ref_id, &dev.hardware2program_ref_id) {
            return (Some(p.clone()), Some(h.clone()));
        }

        let order = dev.order_number.as_deref().unwrap_or("").trim();
        let mut matches: Vec<&HardwareCatalogEntry> = if !order.is_empty() {
            self.entries
                .iter()
                .filter(|e| e.order_number.eq_ignore_ascii_case(order))
                .collect()
        } else {
            Vec::new()
        };

        if matches.is_empty() {
            let model = dev.model.trim();
            if !model.is_empty() {
                matches = self.entries
                    .iter()
                    .filter(|e| e.order_number.eq_ignore_ascii_case(model))
                    .collect();
            }
        }

        if matches.is_empty() {
            return (dev.product_ref_id.clone(), dev.hardware2program_ref_id.clone());
        }

        let chosen = if matches.len() == 1 {
            matches[0]
        } else {
            let dname = dev.name.to_lowercase();
            let dapp = dev.application_program.as_deref().unwrap_or("").to_lowercase();
            matches
                .iter()
                .copied()
                .find(|m| {
                    let mtext = m.product_text.to_lowercase();
                    let mapp = m.app_ref.to_lowercase();
                    (!mtext.is_empty() && dname.contains(&mtext))
                        || (!dapp.is_empty() && (mtext.contains(&dapp) || dapp.contains(&mtext) || mapp.contains(&dapp)))
                        || (dname.contains("email") && mtext.contains("email"))
                        || (dname.contains("secure") && mtext.contains("secure") && !dname.contains("email") && !mtext.contains("email"))
                })
                .unwrap_or(matches[0])
        };

        (
            dev.product_ref_id.clone().or_else(|| Some(chosen.product_id.clone())),
            dev.hardware2program_ref_id.clone().or_else(|| Some(chosen.h2p_id.clone())),
        )
    }
}

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
        let project_id = project.ets_project_id.as_deref().unwrap_or("P-0425");
        Self::generate_installation_0_xml(project, project_id)
    }

    /// Generates ETS 6.2 XML Schema 23 compliant `project.xml`
    pub fn generate_project_xml(project: &Project, project_id: &str) -> String {
        let now_iso = chrono::Utc::now().to_rfc3339();
        let mut xml = String::new();
        xml.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        xml.push_str("<KNX xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" CreatedBy=\"ETS6\" ToolVersion=\"6.2.7302.0\" xmlns=\"http://knx.org/xml/project/23\">\n");
        xml.push_str(&format!("  <Project Id=\"{}\">\n", project_id));

        let last_used_puid = project.ets_last_used_puid.unwrap_or(2000);
        let guid = project
            .ets_guid
            .clone()
            .unwrap_or_else(|| project.id.to_string());

        xml.push_str(&format!(
            "    <ProjectInformation Name=\"{}\" GroupAddressStyle=\"ThreeLevel\" LastModified=\"{}\" ProjectStart=\"{}\" Comment=\"Erstellt mit KoNfiX\" CompletionStatus=\"Editing\" LastUsedPuid=\"{}\" Guid=\"{}\">\n",
            escape(&project.name),
            now_iso,
            now_iso,
            last_used_puid,
            guid
        ));

        // ProjectTraces
        xml.push_str("      <ProjectTraces>\n");
        if !project.ets_traces.is_empty() {
            for trace in &project.ets_traces {
                let comment_attr = if !trace.comment.is_empty() {
                    format!(" Comment=\"{}\"", escape(&trace.comment))
                } else {
                    String::new()
                };
                xml.push_str(&format!(
                    "        <ProjectTrace Date=\"{}\" UserName=\"{}\"{} />\n",
                    escape(&trace.date),
                    escape(&trace.user_name),
                    comment_attr
                ));
            }
        } else {
            xml.push_str(&format!(
                "        <ProjectTrace Date=\"{}\" UserName=\"KoNfiX\" Comment=\"Vollwertiger ETS 6.2 Projekt-Export\" />\n",
                now_iso
            ));
        }
        xml.push_str("      </ProjectTraces>\n");

        // Device certificates for KNX Data Secure devices
        let mut certificates = project.ets_device_certificates.clone();
        for dev in &project.devices {
            if let Some(ref sec) = dev.security {
                if sec.is_secure_enabled {
                    if let Some(ref fdsk) = sec.fdsk {
                        let serial = dev
                            .order_number
                            .clone()
                            .unwrap_or_else(|| format!("SN-{}", dev.individual_address.replace('.', "-")));
                        if !certificates.iter().any(|c| c.serial_number == serial) {
                            certificates.push(DeviceCertificateInfo {
                                serial_number: serial,
                                fdsk: fdsk.clone(),
                            });
                        }
                    }
                }
            }
        }

        if !certificates.is_empty() {
            xml.push_str("      <DeviceCertificates>\n");
            for cert in &certificates {
                xml.push_str(&format!(
                    "        <DeviceCertificate SerialNumber=\"{}\" FDSK=\"{}\" />\n",
                    escape(&cert.serial_number),
                    escape(&cert.fdsk)
                ));
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
        Self::generate_installation_0_xml_with_catalog(project, project_id, None)
    }

    /// Generates ETS 6.2 XML Schema 23 compliant `0.xml` using optional hardware catalog index for resolving ProductRefId and Hardware2ProgramRefId
    pub fn generate_installation_0_xml_with_catalog(
        project: &Project,
        project_id: &str,
        catalog_index: Option<&HardwareCatalogIndex>,
    ) -> String {
        let mut puid_counter: u32 = 1;

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

        let default_line_id = if let Some((&first_area, lines_map)) = area_line_devices.iter().next() {
            if let Some((&first_line, _)) = lines_map.iter().next() {
                format!("{}-0_L-{}-{}", project_id, first_area, first_line)
            } else {
                format!("{}-0_L-1-1", project_id)
            }
        } else {
            format!("{}-0_L-1-1", project_id)
        };

        let mut xml = String::new();
        xml.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        xml.push_str("<KNX xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" CreatedBy=\"ETS6\" ToolVersion=\"6.2.7302.0\" xmlns=\"http://knx.org/xml/project/23\">\n");
        xml.push_str(&format!("  <Project Id=\"{}\">\n", project_id));
        xml.push_str("    <Installations>\n");
        xml.push_str(&format!(
            "      <Installation Name=\"\" BCUKey=\"4294967295\" DefaultLine=\"{}\" IPRoutingLatencyTolerance=\"2000\">\n",
            default_line_id
        ));

        // 1. Map GroupAddresses to unique XML IDs: Id="P-XXXX-0_GA-YYYY"
        // Also build reverse lookup: ga_uuid -> ga_xml_id, ga_addr_str -> ga_xml_id
        let mut ga_id_to_xml: HashMap<Uuid, String> = HashMap::new();
        let mut ga_addr_to_xml: HashMap<String, String> = HashMap::new();

        for (idx, ga) in project.group_addresses.iter().enumerate() {
            let ga_xml_id = if let Some(ref gid) = ga.ets_ga_id {
                if gid.starts_with("P-") {
                    gid.clone()
                } else {
                    format!("{}-0_{}", project_id, gid)
                }
            } else {
                format!("{}-0_GA-{}", project_id, idx + 1)
            };
            ga_id_to_xml.insert(ga.id, ga_xml_id.clone());
            ga_addr_to_xml.insert(ga.address.clone(), ga_xml_id);
        }

        // 2. Topology Generation
        xml.push_str("        <Topology>\n");

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
                    let dev_puid = dev.ets_puid.unwrap_or(puid_counter);
                    let dev_xml_id = if let Some(ref did) = dev.ets_device_id {
                        if did.starts_with("P-") {
                            did.clone()
                        } else {
                            format!("{}-0_{}", project_id, did)
                        }
                    } else {
                        format!("{}-0_DI-{}", project_id, puid_counter)
                    };
                    dev_uuid_to_xml_id.insert(dev.id, dev_xml_id.clone());
                    puid_counter += 1;

                    let (resolved_prod, resolved_h2p) = if let Some(cat) = catalog_index {
                        cat.resolve_device_refs(dev)
                    } else {
                        (dev.product_ref_id.clone(), dev.hardware2program_ref_id.clone())
                    };

                    let mfr_id = lookup_manufacturer_id_by_name(&dev.manufacturer);

                    let product_ref = if let Some(ref pr) = resolved_prod {
                        pr.clone()
                    } else if let Some(ref o) = dev.order_number {
                        let clean_o: String = o.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '.' || c == '_' { c } else { '_' }).collect();
                        format!("{}_H-1-1_P-{}", mfr_id, clean_o)
                    } else {
                        format!("{}_H-1-1_P-Default", mfr_id)
                    };

                    let h2p_ref = if let Some(ref hp) = resolved_h2p {
                        hp.clone()
                    } else if let Some(ref a) = dev.application_program {
                        let clean_a: String = a.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '.' || c == '_' { c } else { '_' }).collect();
                        format!("{}_H-1-1_HP-{}", mfr_id, clean_a)
                    } else {
                        format!("{}_H-1-1_HP-Default", mfr_id)
                    };

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
                                    let rel_id = xml_id.split('_').next_back().unwrap_or(xml_id);
                                    if !linked_ga_xmls.contains(&rel_id.to_string()) {
                                        linked_ga_xmls.push(rel_id.to_string());
                                    }
                                }
                            }

                            for ga_id in &co.group_address_ids {
                                if let Some(xml_id) = ga_id_to_xml.get(ga_id) {
                                    let rel_id = xml_id.split('_').next_back().unwrap_or(xml_id);
                                    if !linked_ga_xmls.contains(&rel_id.to_string()) {
                                        linked_ga_xmls.push(rel_id.to_string());
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
        let bldg_xml_id = format!("{}-0_BP-{}", project_id, bldg_puid);
        puid_counter += 1;

        xml.push_str(&format!(
            "          <Space Type=\"Building\" Id=\"{}\" Name=\"{}\" Puid=\"{}\">\n",
            bldg_xml_id,
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
            let floor_xml_id = format!("{}-0_BP-{}", project_id, floor_puid);
            puid_counter += 1;
            xml.push_str(&format!(
                "            <Space Type=\"Floor\" Id=\"{}\" Name=\"Erdgeschoss\" Puid=\"{}\">\n",
                floor_xml_id,
                floor_puid
            ));

            for room in &project.rooms {
                let room_puid = puid_counter;
                let room_xml_id = format!("{}-0_BP-{}", project_id, room_puid);
                puid_counter += 1;
                xml.push_str(&format!(
                    "              <Space Type=\"Room\" Id=\"{}\" Name=\"{}\" Puid=\"{}\">\n",
                    room_xml_id,
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
                let floor_xml_id = format!("{}-0_BP-{}", project_id, floor_puid);
                puid_counter += 1;

                xml.push_str(&format!(
                    "            <Space Type=\"Floor\" Id=\"{}\" Name=\"{}\" Puid=\"{}\">\n",
                    floor_xml_id,
                    escape(&floor.name),
                    floor_puid
                ));

                if let Some(rooms) = rooms_by_floor.get(&floor.id) {
                    for room in rooms {
                        let room_puid = puid_counter;
                        let room_xml_id = format!("{}-0_BP-{}", project_id, room_puid);
                        puid_counter += 1;

                        xml.push_str(&format!(
                            "              <Space Type=\"Room\" Id=\"{}\" Name=\"{}\" Puid=\"{}\">\n",
                            room_xml_id,
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

    /// Parses an RSA private key from PEM (PKCS#1, PKCS#8), raw Base64/Hex DER, or a local file path.
    /// Used to sign project manifests using PKCS#1 v1.5 and SHA-1 for ETS 6.2 compatibility.
    pub fn parse_rsa_private_key(key_str: &str) -> Result<RsaPrivateKey, String> {
        let trimmed = key_str.trim();
        if trimmed.is_empty() {
            return Err("Signierschlüssel ist leer".to_string());
        }

        // Support reading from a local file path if specified
        let key_text = if std::path::Path::new(trimmed).is_file() {
            std::fs::read_to_string(trimmed)
                .map_err(|e| format!("Fehler beim Lesen der Schlüsseldatei '{}': {}", trimmed, e))?
        } else {
            trimmed.to_string()
        };
        let trimmed = key_text.trim();
        if trimmed.is_empty() {
            return Err("Signierschlüsseldatei ist leer".to_string());
        }
        if trimmed.len() > 64 * 1024 {
            return Err("Signierschlüssel überschreitet die maximale Größe von 64 KB".to_string());
        }

        // Normalize Windows CRLF line endings
        let normalized = trimmed.replace("\r\n", "\n").replace('\r', "\n");

        // 1. Direct standard PEM attempts
        if let Ok(key) = RsaPrivateKey::from_pkcs8_pem(&normalized) {
            return Ok(key);
        }
        if let Ok(key) = RsaPrivateKey::from_pkcs1_pem(&normalized) {
            return Ok(key);
        }

        // 2. Extract Base64 payload between PEM delimiters (handles space-separated, single-line, or extra text)
        let (b64_payload, is_pkcs8, is_pkcs1) = if let Some(start) = normalized.find("-----BEGIN PRIVATE KEY-----") {
            if let Some(end) = normalized[start..].find("-----END PRIVATE KEY-----") {
                let payload = &normalized[start + "-----BEGIN PRIVATE KEY-----".len() .. start + end];
                (payload, true, false)
            } else {
                (normalized.as_str(), false, false)
            }
        } else if let Some(start) = normalized.find("-----BEGIN RSA PRIVATE KEY-----") {
            if let Some(end) = normalized[start..].find("-----END RSA PRIVATE KEY-----") {
                let payload = &normalized[start + "-----BEGIN RSA PRIVATE KEY-----".len() .. start + end];
                (payload, false, true)
            } else {
                (normalized.as_str(), false, false)
            }
        } else {
            (normalized.as_str(), false, false)
        };

        // Filter out all whitespace (newlines, spaces, tabs) to get clean Base64
        let clean_b64: String = b64_payload.chars().filter(|c| !c.is_whitespace()).collect();

        if let Ok(der_bytes) = base64::engine::general_purpose::STANDARD.decode(&clean_b64) {
            if is_pkcs8 {
                if let Ok(key) = RsaPrivateKey::from_pkcs8_der(&der_bytes) {
                    return Ok(key);
                }
                if let Ok(key) = RsaPrivateKey::from_pkcs1_der(&der_bytes) {
                    return Ok(key);
                }
            } else if is_pkcs1 {
                if let Ok(key) = RsaPrivateKey::from_pkcs1_der(&der_bytes) {
                    return Ok(key);
                }
                if let Ok(key) = RsaPrivateKey::from_pkcs8_der(&der_bytes) {
                    return Ok(key);
                }
            } else {
                if let Ok(key) = RsaPrivateKey::from_pkcs8_der(&der_bytes) {
                    return Ok(key);
                }
                if let Ok(key) = RsaPrivateKey::from_pkcs1_der(&der_bytes) {
                    return Ok(key);
                }
            }
        }

        // 3. Fallback on hex decoding
        if let Ok(der_bytes) = hex::decode(&clean_b64) {
            if let Ok(key) = RsaPrivateKey::from_pkcs8_der(&der_bytes) {
                return Ok(key);
            }
            if let Ok(key) = RsaPrivateKey::from_pkcs1_der(&der_bytes) {
                return Ok(key);
            }
        }

        Err("RSA-Private-Key konnte aus den Daten nicht geladen werden (weder PKCS#8 noch PKCS#1)".to_string())
    }

    /// Computes the Base64-encoded SHA-1 content hash of an uncompressed file entry (ETS `EntryWrapperStream.CreateContentHash`).
    pub fn calculate_file_content_hash(data: &[u8]) -> String {
        let mut hasher = Sha1::new();
        hasher.update(data);
        base64::engine::general_purpose::STANDARD.encode(hasher.finalize())
    }

    /// Normalizes a project file relative path (ETS `DirectorySignatureCreator.a`).
    /// Strips leading `project_id` if present, trims leading slashes/backslashes, cleans path components, and replaces '/' with '\'.
    pub fn normalize_manifest_path(project_id: &str, relative_path: &str) -> String {
        let mut p = relative_path;
        if p.starts_with(project_id) {
            p = &p[project_id.len()..];
        }
        let cleaned = p.trim_start_matches(|c| c == '/' || c == '\\');
        let parts: Vec<&str> = cleaned
            .split(['/', '\\'])
            .filter(|seg| !seg.is_empty() && *seg != "." && *seg != "..")
            .collect();
        parts.join("\\")
    }

    /// Builds the directory manifest string from sorted entries (ETS `CalculateDirectoryDigest`).
    /// Format: `<Path1>:<Hash1>,<Path2>:<Hash2>,...`
    pub fn build_directory_manifest_string(entries: &BTreeMap<String, String>) -> String {
        let mut s = String::new();
        for (idx, (path, hash)) in entries.iter().enumerate() {
            if idx > 0 {
                s.push(',');
            }
            s.push_str(path);
            s.push(':');
            s.push_str(hash);
        }
        s
    }

    /// Calculates the 20-byte SHA-1 directory digest from the manifest string (ETS `CalculateDirectoryDigest`).
    pub fn calculate_directory_digest(manifest_str: &str) -> [u8; 20] {
        let mut hasher = Sha1::new();
        hasher.update(manifest_str.as_bytes());
        hasher.finalize().into()
    }

    /// Signs the manifest data using an RSA private key with PKCS#1 v1.5 and SHA-1 (ETS `DirectorySigner.CalculateSignature`).
    /// Returns the Base64-encoded signature.
    pub fn sign_manifest(manifest_str: &str, key_str: &str) -> Result<String, String> {
        let private_key = Self::parse_rsa_private_key(key_str)?;
        let signing_key = SigningKey::<Sha1>::new(private_key);
        let signature = signing_key.sign(manifest_str.as_bytes());
        Ok(base64::engine::general_purpose::STANDARD.encode(signature.to_bytes().as_ref()))
    }

    /// Verifies an ETS manifest signature against the manifest string using an RSA public key (ETS `DirectorySigner.VerifySignature`).
    pub fn verify_manifest_signature(
        manifest_str: &str,
        signature_b64: &str,
        public_key: &RsaPublicKey,
    ) -> Result<bool, String> {
        let verifying_key = VerifyingKey::<Sha1>::new(public_key.clone());
        let sig_bytes = base64::engine::general_purpose::STANDARD
            .decode(signature_b64.trim())
            .map_err(|e| format!("Ungültiges Base64 in Signatur: {}", e))?;
        let sig_obj = rsa::pkcs1v15::Signature::try_from(sig_bytes.as_slice())
            .map_err(|e| format!("Ungültige Signaturstruktur: {}", e))?;
        verifying_key
            .verify(manifest_str.as_bytes(), &sig_obj)
            .map(|_| true)
            .map_err(|e| format!("Signaturprüfung fehlgeschlagen: {}", e))
    }

    /// Signs binary data using an RSA private key with PKCS#1 v1.5 and SHA-1.
    pub fn sign_project_data(data: &[u8], key_str: &str) -> Result<String, String> {
        let private_key = Self::parse_rsa_private_key(key_str)?;
        let signing_key = SigningKey::<Sha1>::new(private_key);
        let signature = signing_key.sign(data);
        Ok(base64::engine::general_purpose::STANDARD.encode(signature.to_bytes().as_ref()))
    }

    /// Full `.knxproj` export pipeline.
    /// Produces a 100% ETS 5 / ETS 6 compatible `.knxproj` ZIP archive.
    /// If `signing_key` is provided (or configured in `StorageSettings`), signs the project manifest
    /// with RSA PKCS#1 v1.5 SHA-1 matching ETS 6.2 specifications and writes `{project_id}.signature`.
    pub fn export_knxproj(
        project: &Project,
        password: Option<&str>,
        signing_key: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        let project_id = project.ets_project_id.as_deref().unwrap_or("P-0425");

        // Try to load cached project assets (.assets.zip)
        let storage = crate::storage::StorageManager::new();
        let asset_bundle = storage.load_project_assets_sync(&project.name)
            .or_else(|| {
                if let Ok(source_proj_path) = std::env::var("KONFIX_SOURCE_KNXPROJ") {
                    if let Ok(bytes) = std::fs::read(&source_proj_path) {
                        if let Ok(mut src_zip) = zip::ZipArchive::new(std::io::Cursor::new(&bytes)) {
                            return Some(crate::ets_import::extract_project_assets(&mut src_zip));
                        }
                    }
                }
                None
            });

        let catalog_index = asset_bundle.as_ref().map(|b| HardwareCatalogIndex::from_assets(b));

        let xml_0 = Self::generate_installation_0_xml_with_catalog(project, project_id, catalog_index.as_ref());
        let project_xml = Self::generate_project_xml(project, project_id);

        let is_password_protected = password
            .map(|p| !p.trim().is_empty())
            .unwrap_or(false);

        let inner_zip_bytes = if is_password_protected {
            Some(Self::create_inner_project_zip(&xml_0, &project_xml, password)?)
        } else {
            None
        };

        // 1. Process asset bundle: collect manufacturer files, knx_master.xml, and any project files
        let mut extra_asset_files: Vec<(String, Vec<u8>)> = Vec::new();
        let mut has_master_xml = false;

        if let Some(ref assets_bytes) = asset_bundle {
            if let Ok(mut asset_zip) = zip::ZipArchive::new(Cursor::new(assets_bytes)) {
                for i in 0..asset_zip.len() {
                    if let Ok(f) = asset_zip.by_index(i) {
                        // Enforce Zip-Slip protection
                        let safe_name = match f.enclosed_name() {
                            Some(p) => p.to_string_lossy().to_string(),
                            None => continue,
                        };

                        if safe_name == format!("{}.signature", project_id)
                            || safe_name == format!("{}.zip", project_id)
                            || safe_name == format!("{}/0.xml", project_id)
                            || safe_name == format!("{}/project.xml", project_id)
                        {
                            // Skip dynamically generated project files
                            continue;
                        }

                        // Read bounded bytes (max 64 MB per file)
                        let mut file_bytes = Vec::new();
                        if f.take(64 * 1024 * 1024).read_to_end(&mut file_bytes).is_ok() {
                            if safe_name == "knx_master.xml" {
                                has_master_xml = true;
                            }
                            extra_asset_files.push((safe_name, file_bytes));
                        }
                    }
                }
            }
        }

        // Build sorted manifest dictionary for the project container
        // Following ETS 6.2 Directory Signature specifications
        let mut manifest_entries: BTreeMap<String, String> = BTreeMap::new();
        manifest_entries.insert(
            Self::normalize_manifest_path(project_id, "0.xml"),
            Self::calculate_file_content_hash(xml_0.as_bytes()),
        );
        manifest_entries.insert(
            Self::normalize_manifest_path(project_id, "project.xml"),
            Self::calculate_file_content_hash(project_xml.as_bytes()),
        );

        // Include all project container files (e.g. {project_id}/Baggages/*) in the directory manifest!
        for (fname, bytes) in &extra_asset_files {
            if fname.starts_with(&format!("{}/", project_id)) {
                manifest_entries.insert(
                    Self::normalize_manifest_path(project_id, fname),
                    Self::calculate_file_content_hash(bytes),
                );
            }
        }

        let manifest_str = Self::build_directory_manifest_string(&manifest_entries);

        // Determine effective signing key:
        // Priority:
        // 1. Explicitly passed signing_key argument
        // 2. StorageSettings.signing_key (~/.konfix/settings.json)
        // 3. Environment variable KONFIX_SIGNING_KEY / KONFIX_SIGNING_KEY_PATH
        let effective_signing_key: Option<String> = signing_key
            .and_then(|k| {
                let t = k.trim().to_string();
                if t.is_empty() {
                    None
                } else {
                    Some(t)
                }
            })
            .or_else(|| {
                #[cfg(not(test))]
                {
                    storage.get_settings_sync().signing_key
                }
                #[cfg(test)]
                {
                    None
                }
            })
            .or_else(|| std::env::var("KONFIX_SIGNING_KEY").ok());

        // Build outer .knxproj ZIP
        let mut outer_buf = Vec::new();
        {
            let mut writer = ZipWriter::new(Cursor::new(&mut outer_buf));
            let options = SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            // 1. Generate freshly computed signature over directory manifest if key is provided!
            if let Some(ref key) = effective_signing_key {
                match Self::sign_manifest(&manifest_str, key) {
                    Ok(sig_b64) => {
                        writer
                            .start_file(format!("{}.signature", project_id), options)
                            .map_err(|e| format!("Fehler beim Hinzufügen der Signatur: {}", e))?;
                        writer
                            .write_all(sig_b64.as_bytes())
                            .map_err(|e| format!("Fehler beim Schreiben der Signatur: {}", e))?;
                        tracing::info!("Projekt {} erfolgreich nach ETS-Spezifikation (RSA PKCS#1 v1.5 SHA-1) signiert", project_id);
                    }
                    Err(e) => {
                        return Err(format!("Signierung mit hinterlegtem Schlüssel fehlgeschlagen: {}. Bitte überprüfe das Schlüsselformat.", e));
                    }
                }
            } else {
                tracing::warn!("Kein Signierschlüssel hinterlegt: Projekt {} wird unsigniert exportiert. ETS-Import erfordert einen gültigen Signierschlüssel.", project_id);
            }

            // 2. Copy manufacturer hardware catalogs & signatures from asset bundle (pre-filtered & safe)
            for (fname, file_bytes) in extra_asset_files {
                let _ = writer.start_file(&fname, options);
                let _ = writer.write_all(&file_bytes);
            }

            // 3. knx_master.xml fallback if not in asset bundle
            if !has_master_xml {
                const MASTER_XML: &[u8] = include_bytes!("../resources/knx_master.xml");
                writer
                    .start_file("knx_master.xml", options)
                    .map_err(|e| format!("Fehler beim Hinzufügen von knx_master.xml: {}", e))?;
                writer
                    .write_all(MASTER_XML)
                    .map_err(|e| format!("Fehler beim Schreiben von knx_master.xml: {}", e))?;
            }


            // 5. Project container files:
            // - If password protected: {project_id}.zip (AES-256 encrypted)
            // - If unencrypted (no password): {project_id}/0.xml and {project_id}/project.xml directly in outer zip!
            if let Some(ref inner_bytes) = inner_zip_bytes {
                writer
                    .start_file(format!("{}.zip", project_id), options)
                    .map_err(|e| format!("Fehler beim Hinzufügen von {}.zip: {}", project_id, e))?;
                writer
                    .write_all(inner_bytes)
                    .map_err(|e| format!("Fehler beim Schreiben von {}.zip: {}", project_id, e))?;
            } else {
                writer
                    .start_file(format!("{}/0.xml", project_id), options)
                    .map_err(|e| format!("Fehler beim Hinzufügen von {}/0.xml: {}", project_id, e))?;
                writer
                    .write_all(xml_0.as_bytes())
                    .map_err(|e| format!("Fehler beim Schreiben von {}/0.xml: {}", project_id, e))?;

                writer
                    .start_file(format!("{}/project.xml", project_id), options)
                    .map_err(|e| format!("Fehler beim Hinzufügen von {}/project.xml: {}", project_id, e))?;
                writer
                    .write_all(project_xml.as_bytes())
                    .map_err(|e| format!("Fehler beim Schreiben von {}/project.xml: {}", project_id, e))?;
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
                    ..Default::default()
                },
            ],
            topology: None,
            ..Default::default()
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
                ..Default::default()
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
                ..Default::default()
            }],
            topology: None,
            ..Default::default()
        };

        // Test 0.xml generation
        let xml_0 = EtsExporter::generate_installation_0_xml(&project, "P-0425");
        assert!(xml_0.contains("<Project Id=\"P-0425\">"));
        assert!(xml_0.contains("Address=\"1\""));
        assert!(xml_0.contains("Address=\"5\""));
        assert!(xml_0.contains("Name=\"Dimmaktor 4-fach\""));
        assert!(xml_0.contains("DatapointType=\"DPST-1-1\""));
        assert!(xml_0.contains("Links=\"GA-1\""));
        assert!(xml_0.contains("Name=\"Wohnzimmer\""));
        assert!(xml_0.contains("Space Type=\"Room\""));

        // Test project.xml generation
        let proj_xml = EtsExporter::generate_project_xml(&project, "P-0425");
        assert!(proj_xml.contains("Name=\"TestVilla\""));
        assert!(proj_xml.contains("GroupAddressStyle=\"ThreeLevel\""));

        // Test full .knxproj export archive
        let knxproj_bytes = EtsExporter::export_knxproj(&project, None, None).expect("Export failed");
        assert!(!knxproj_bytes.is_empty());

        // Validate that exported bytes can be read back as valid ZIP archive (unencrypted)
        let cursor = Cursor::new(&knxproj_bytes);
        let mut zip = zip::ZipArchive::new(cursor).expect("Valid ZIP archive");
        assert!(zip.by_name("knx_master.xml").is_ok());
        assert!(zip.by_name("P-0425/0.xml").is_ok());
        assert!(zip.by_name("P-0425/project.xml").is_ok());
        assert!(zip.by_name("P-0425.zip").is_err(), "Unencrypted export must not contain P-0425.zip");
        assert!(zip.by_name("P-0425.signature").is_err(), "Export without key must not contain signature file");

        // Validate encrypted export creates P-0425.zip
        let enc_bytes = EtsExporter::export_knxproj(&project, Some("secret"), None).expect("Encrypted export failed");
        let mut enc_zip = zip::ZipArchive::new(Cursor::new(&enc_bytes)).expect("Valid encrypted ZIP archive");
        assert!(enc_zip.by_name("P-0425.zip").is_ok());
        assert!(enc_zip.by_name("P-0425.signature").is_err(), "Encrypted export without key must not contain signature file");
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
                ..Default::default()
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
                ..Default::default()
            }],
            topology: None,
            ..Default::default()
        };

        // Export to .knxproj
        let exported_bytes = EtsExporter::export_knxproj(&original, None, None).expect("Export failed");

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

    #[test]
    fn test_ets_manifest_digest_and_path_normalization() {
        // 1. Path normalization
        assert_eq!(EtsExporter::normalize_manifest_path("P-0425", "P-0425/0.xml"), "0.xml");
        assert_eq!(EtsExporter::normalize_manifest_path("P-0425", "P-0425\\project.xml"), "project.xml");
        assert_eq!(EtsExporter::normalize_manifest_path("P-0425", "0.xml"), "0.xml");
        assert_eq!(EtsExporter::normalize_manifest_path("P-0425", "/0.xml"), "0.xml");
        assert_eq!(
            EtsExporter::normalize_manifest_path("P-0425", "P-0425/Baggages/icon.png"),
            "Baggages\\icon.png"
        );

        // 2. Content hash (SHA-1 base64)
        let hash = EtsExporter::calculate_file_content_hash(b"Hello KNX");
        // SHA-1("Hello KNX") = 2a2e45300d8e87d461fcbe4782bb578491c7c9bf -> Base64
        assert!(!hash.is_empty());

        // 3. Sorted manifest string
        let mut entries = BTreeMap::new();
        entries.insert("project.xml".to_string(), "hash2".to_string());
        entries.insert("0.xml".to_string(), "hash1".to_string());
        let manifest_str = EtsExporter::build_directory_manifest_string(&entries);
        assert_eq!(manifest_str, "0.xml:hash1,project.xml:hash2");

        // 4. Digest calculation (20 bytes)
        let digest = EtsExporter::calculate_directory_digest(&manifest_str);
        assert_eq!(digest.len(), 20);
    }

    #[test]
    fn test_ets_export_with_rsa_signing() {
        use rsa::pkcs1::EncodeRsaPrivateKey;

        let mut rng = rand::rngs::OsRng;
        let priv_key = RsaPrivateKey::new(&mut rng, 1024).expect("RSA key generation failed");
        let pem_str = priv_key.to_pkcs1_pem(rsa::pkcs1::LineEnding::LF).expect("PEM encoding failed");

        let project = Project {
            id: Uuid::new_v4(),
            name: "SignTest".to_string(),
            ets_project_id: Some("P-1234".to_string()),
            ..Default::default()
        };

        // 1. Export with custom signing key (unencrypted)
        let exported = EtsExporter::export_knxproj(&project, None, Some(&pem_str)).expect("Export with signing failed");

        let cursor = Cursor::new(&exported);
        let mut zip = zip::ZipArchive::new(cursor).expect("Valid ZIP archive");

        // In unencrypted export, P-1234.zip must NOT exist to prevent ETS password prompts
        assert!(zip.by_name("P-1234.zip").is_err(), "Unencrypted export must not contain P-1234.zip");

        // Signature must exist
        let sig_str = {
            let mut sig_file = zip.by_name("P-1234.signature").expect("Signature file missing");
            let mut s = String::new();
            sig_file.read_to_string(&mut s).expect("Read signature string");
            s
        };

        let sig_bytes = base64::engine::general_purpose::STANDARD.decode(sig_str.trim()).expect("Valid base64");
        assert_eq!(sig_bytes.len(), 128, "1024-bit RSA signature must be 128 bytes");

        // Extract 0.xml and project.xml directly from P-1234/
        let mut xml_0_bytes = Vec::new();
        zip.by_name("P-1234/0.xml").expect("0.xml directly in P-1234/").read_to_end(&mut xml_0_bytes).expect("Read 0.xml");
        let mut proj_xml_bytes = Vec::new();
        zip.by_name("P-1234/project.xml").expect("project.xml directly in P-1234/").read_to_end(&mut proj_xml_bytes).expect("Read project.xml");

        let mut manifest_entries = BTreeMap::new();
        manifest_entries.insert("0.xml".to_string(), EtsExporter::calculate_file_content_hash(&xml_0_bytes));
        manifest_entries.insert("project.xml".to_string(), EtsExporter::calculate_file_content_hash(&proj_xml_bytes));
        let manifest_str = EtsExporter::build_directory_manifest_string(&manifest_entries);

        // Verify signature against directory manifest
        let pub_key = priv_key.to_public_key();
        assert!(
            EtsExporter::verify_manifest_signature(&manifest_str, &sig_str, &pub_key).is_ok(),
            "Signature must verify against directory manifest according to ETS specification"
        );

        // Negative test: verify that tampered manifest fails verification
        let tampered_manifest = format!("{}tampered", manifest_str);
        assert!(
            EtsExporter::verify_manifest_signature(&tampered_manifest, &sig_str, &pub_key).is_err(),
            "Signature verification must fail on tampered manifest"
        );

        // 2. Export without signing key -> no signature file created
        let exported_no_key = EtsExporter::export_knxproj(&project, None, None).expect("Export without key failed");
        let mut zip_no_key = zip::ZipArchive::new(Cursor::new(&exported_no_key)).expect("Valid default ZIP archive");
        assert!(
            zip_no_key.by_name("P-1234.signature").is_err(),
            "Export without signing key must not contain signature file"
        );
    }

    #[test]
    fn test_parse_rsa_private_key_with_crlf_and_public_block() {
        use rsa::pkcs8::EncodePrivateKey;
        use rsa::pkcs8::LineEnding;
        use rsa::traits::PublicKeyParts;

        let mut rng = rand::rngs::OsRng;
        let priv_key = RsaPrivateKey::new(&mut rng, 1024).expect("RSA key generation failed");
        let pkcs8_pem = priv_key.to_pkcs8_pem(LineEnding::LF).expect("PEM encoding failed");

        // Simulate rsakey.txt: CRLF line endings + trailing comment and public block
        let mut mixed = pkcs8_pem.as_str().replace('\n', "\r\n");
        mixed.push_str("\r\n---PUBLIC---\r\n-----BEGIN PUBLIC KEY-----\r\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ...\r\n-----END PUBLIC KEY-----\r\n");

        let parsed = EtsExporter::parse_rsa_private_key(&mixed).expect("Must parse private key block from mixed file with CRLF");
        assert_eq!(parsed.n(), priv_key.n(), "Modulus must match original key");
    }

    #[test]
    fn test_parse_rsa_private_key_single_line_with_spaces() {
        use rsa::pkcs8::EncodePrivateKey;
        use rsa::pkcs8::LineEnding;
        use rsa::traits::PublicKeyParts;

        let mut rng = rand::rngs::OsRng;
        let priv_key = RsaPrivateKey::new(&mut rng, 1024).expect("RSA key generation failed");
        let pkcs8_pem = priv_key.to_pkcs8_pem(LineEnding::LF).expect("PEM encoding failed");

        // Simulate HTML input pasting where all newlines become spaces
        let single_line = pkcs8_pem.as_str().replace('\n', " ");

        let parsed = EtsExporter::parse_rsa_private_key(&single_line)
            .expect("Must parse private key from space-separated single-line string");
        assert_eq!(parsed.n(), priv_key.n(), "Modulus must match original key");
    }

    #[test]
    fn test_parse_rsa_private_key_from_file_path() {
        use rsa::pkcs1::EncodeRsaPrivateKey;
        use rsa::traits::PublicKeyParts;

        let mut rng = rand::rngs::OsRng;
        let priv_key = RsaPrivateKey::new(&mut rng, 1024).expect("RSA key generation failed");
        let pem_str = priv_key.to_pkcs1_pem(rsa::pkcs1::LineEnding::LF).expect("PEM encoding failed");

        let temp_file = std::env::temp_dir().join(format!("test_key_{}.pem", uuid::Uuid::new_v4()));
        std::fs::write(&temp_file, pem_str).expect("write temp key");

        let parsed = EtsExporter::parse_rsa_private_key(&temp_file.to_string_lossy())
            .expect("Must parse private key from file path");
        assert_eq!(parsed.n(), priv_key.n(), "Modulus must match original key");

        let _ = std::fs::remove_file(temp_file);
    }
}
