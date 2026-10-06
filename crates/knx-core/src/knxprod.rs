use crate::model::*;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::info;
use uuid::Uuid;

/// Converts KNX XML DatapointType string (e.g. "DPST-1-8", "DPT-1", "DPST-5-1") into standard DPT format (e.g. "1.008", "1.001", "5.001")
pub fn format_knxprod_dpt(raw: &str) -> String {
    let clean = raw.trim();
    if clean.is_empty() {
        return "1.001".to_string();
    }

    if let Some(rest) = clean.strip_prefix("DPST-") {
        let parts: Vec<&str> = rest.split('-').collect();
        if parts.len() >= 2 {
            let main = parts[0].parse::<u32>().unwrap_or(1);
            let sub = parts[1].parse::<u32>().unwrap_or(1);
            return format!("{}.{:03}", main, sub);
        }
    } else if let Some(rest) = clean.strip_prefix("DPT-") {
        let main = rest.parse::<u32>().unwrap_or(1);
        return format!("{}.001", main);
    }

    if clean.contains('.') {
        clean.to_string()
    } else {
        "1.001".to_string()
    }
}

/// Maximum allowed decompressed size for a single XML file in an archive (64 MB)
const MAX_DECOMPRESSED_ENTRY_SIZE: u64 = 64 * 1024 * 1024;

/// Parses a .knxprod ZIP file and returns all catalog products contained within it
pub fn parse_knxprod(bytes: &[u8]) -> Result<Vec<CatalogProduct>, String> {
    let reader = Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader)
        .map_err(|e| format!("Ungültiges .knxprod ZIP-Archiv: {}", e))?;

    let mut hardware_xmls: Vec<String> = Vec::new();
    let mut app_program_xmls: HashMap<String, String> = HashMap::new();

    for i in 0..zip.len() {
        if let Ok(mut file) = zip.by_index(i) {
            let name = file.name().to_string();
            if name.ends_with("Hardware.xml") || name.ends_with("hardware.xml") {
                let mut content = String::new();
                use std::io::Read;
                if file.by_ref().take(MAX_DECOMPRESSED_ENTRY_SIZE + 1).read_to_string(&mut content).is_ok() {
                    if content.len() as u64 <= MAX_DECOMPRESSED_ENTRY_SIZE {
                        hardware_xmls.push(content);
                    } else {
                        return Err(format!("Hardware-XML '{}' überschreitet Sicherheitsgrenze von 64 MB (mögliche Decompression-Bomb)", name));
                    }
                }
            } else if (name.contains("_A-") || name.contains("ApplicationProgram")) && name.ends_with(".xml") {
                let mut content = String::new();
                use std::io::Read;
                if file.by_ref().take(MAX_DECOMPRESSED_ENTRY_SIZE + 1).read_to_string(&mut content).is_ok() {
                    if content.len() as u64 <= MAX_DECOMPRESSED_ENTRY_SIZE {
                        app_program_xmls.insert(name, content);
                    } else {
                        return Err(format!("AppProgram-XML '{}' überschreitet Sicherheitsgrenze von 64 MB (mögliche Decompression-Bomb)", name));
                    }
                }
            }
        }
    }

    if hardware_xmls.is_empty() {
        // Fallback: Check if any XML contains <Hardware>
        for i in 0..zip.len() {
            if let Ok(mut file) = zip.by_index(i) {
                let name = file.name().to_string();
                if name.ends_with(".xml") && !name.contains("Catalog") && !name.contains("knx_master") {
                    let mut content = String::new();
                    use std::io::Read;
                    if file.by_ref().take(MAX_DECOMPRESSED_ENTRY_SIZE + 1).read_to_string(&mut content).is_ok()
                        && content.contains("<Hardware")
                    {
                        if content.len() as u64 <= MAX_DECOMPRESSED_ENTRY_SIZE {
                            hardware_xmls.push(content);
                        } else {
                            return Err(format!("Hardware-XML '{}' überschreitet Sicherheitsgrenze von 64 MB", name));
                        }
                    }
                }
            }
        }
    }

    let mut products = Vec::new();

    for hw_xml in hardware_xmls {
        let parsed_list = parse_hardware_xml(&hw_xml, &app_program_xmls)?;
        products.extend(parsed_list);
    }

    Ok(products)
}

#[derive(Default, Debug)]
#[allow(dead_code)]
struct RawHwProduct {
    id: String,
    order_number: String,
    text: String,
    hw_name: String,
    bus_current: u16,
    app_ref: String,
    manufacturer_ref: String,
    de_translations: HashMap<String, String>,
}

#[derive(Debug, Clone, Default)]
pub struct ParamTypeMeta {
    pub size_in_bit: Option<u32>,
    pub is_float: Option<bool>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub type_kind: Option<String>,
}

#[derive(Default, Debug)]
struct RawHwBlock {
    #[allow(dead_code)]
    id: String,
    name: String,
    bus_current: u16,
    products: Vec<RawHwProduct>,
    app_refs: Vec<String>,
}

pub fn lookup_knx_manufacturer(ref_id: &str) -> String {
    let clean = ref_id.strip_prefix("M-").unwrap_or(ref_id);
    match clean {
        "0001" => "Siemens".to_string(),
        "0002" => "ABB".to_string(),
        "0004" => "Theben / Jung".to_string(),
        "0005" => "Gira".to_string(),
        "0008" => "Berker / Hager".to_string(),
        "0083" => "MDT Technologies".to_string(),
        "00C5" => "Elsner Elektronik".to_string(),
        "00C7" => "Lingg & Janke".to_string(),
        "00FA" => "Weinzierl Engineering GmbH".to_string(),
        "010F" => "Sation Factory".to_string(),
        "0137" => "Schneider Electric".to_string(),
        _ => {
            if ref_id.starts_with("M-") {
                format!("Hersteller ({})", ref_id)
            } else if !ref_id.is_empty() {
                ref_id.to_string()
            } else {
                "Unbekannter Hersteller".to_string()
            }
        }
    }
}

pub fn get_lang_priority(lang_id: &str) -> u8 {
    if lang_id.eq_ignore_ascii_case("de-DE") {
        3
    } else if lang_id.to_lowercase().starts_with("de") {
        2
    } else if lang_id.to_lowercase().starts_with("en") {
        1
    } else {
        0
    }
}

fn parse_hardware_xml(
    hw_xml: &str,
    app_xmls: &HashMap<String, String>,
) -> Result<Vec<CatalogProduct>, String> {
    let mut reader = Reader::from_str(hw_xml);
    reader.config_mut().trim_text(true);

    let mut manufacturer_name = String::new();
    let mut current_hw_block: Option<RawHwBlock> = None;
    let mut hw_blocks: Vec<RawHwBlock> = Vec::new();

    let mut current_lang_prio: u8 = 0;
    let mut current_tr_ref = String::new();
    let mut translations: HashMap<String, (u8, String)> = HashMap::new();

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let tag_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag_name.as_str() {
                    "Manufacturer" => {
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"RefId" => {
                                    let ref_id = String::from_utf8_lossy(&attr.value);
                                    if manufacturer_name.is_empty() {
                                        manufacturer_name = lookup_knx_manufacturer(&ref_id);
                                    }
                                }
                                b"Name" => {
                                    let n = String::from_utf8_lossy(&attr.value).trim().to_string();
                                    if !n.is_empty() {
                                        manufacturer_name = n;
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    "Hardware" => {
                        let mut hw_id = String::new();
                        let mut hw_name = String::new();
                        let mut bus_current = 10u16;
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Id" {
                                hw_id = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"Name" {
                                hw_name = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"BusCurrent" {
                                if let Ok(s) = std::str::from_utf8(&attr.value) {
                                    bus_current = s.parse::<u16>().unwrap_or(10);
                                }
                            }
                        }
                        if !hw_id.is_empty() {
                            current_hw_block = Some(RawHwBlock {
                                id: hw_id,
                                name: hw_name,
                                bus_current,
                                products: Vec::new(),
                                app_refs: Vec::new(),
                            });
                        }
                    }
                    "ApplicationProgramRef" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"RefId" {
                                let apr = String::from_utf8_lossy(&attr.value).to_string();
                                if let Some(ref mut block) = current_hw_block {
                                    block.app_refs.push(apr);
                                }
                            }
                        }
                    }
                    "Product" => {
                        let mfr = if !manufacturer_name.is_empty() {
                            manufacturer_name.clone()
                        } else {
                            "Unbekannter Hersteller".to_string()
                        };
                        let mut p = RawHwProduct {
                            hw_name: current_hw_block.as_ref().map(|b| b.name.clone()).unwrap_or_default(),
                            bus_current: current_hw_block.as_ref().map(|b| b.bus_current).unwrap_or(10),
                            app_ref: String::new(),
                            manufacturer_ref: mfr,
                            ..Default::default()
                        };
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Id" {
                                p.id = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"OrderNumber" {
                                p.order_number = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"Text" {
                                p.text = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        if let Some(ref mut block) = current_hw_block {
                            block.products.push(p);
                        }
                    }
                    "Language" => {
                        current_lang_prio = 0;
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Identifier" {
                                let id = String::from_utf8_lossy(&attr.value);
                                current_lang_prio = get_lang_priority(&id);
                            }
                        }
                    }
                    "TranslationElement" if current_lang_prio > 0 => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"RefId" {
                                current_tr_ref = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                    }
                    "Translation" if current_lang_prio > 0 && !current_tr_ref.is_empty() => {
                        let mut attr_name = String::new();
                        let mut text_val = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"AttributeName" {
                                attr_name = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"Text" {
                                text_val = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        if attr_name == "Text" && !text_val.is_empty() {
                            match translations.get(&current_tr_ref) {
                                Some((prio, _)) if *prio >= current_lang_prio => {}
                                _ => {
                                    translations.insert(current_tr_ref.clone(), (current_lang_prio, text_val));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let tag_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if tag_name == "Hardware" {
                    if let Some(block) = current_hw_block.take() {
                        hw_blocks.push(block);
                    }
                } else if tag_name == "TranslationElement" {
                    current_tr_ref.clear();
                } else if tag_name == "Language" {
                    current_lang_prio = 0;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("Fehler beim Parsen von Hardware.xml: {:?}", e)),
            _ => {}
        }
        buf.clear();
    }

    // Pass 2: Sort app_xml keys deterministically and cache parsed ApplicationPrograms
    let mut sorted_app_keys: Vec<String> = app_xmls.keys().cloned().collect();
    sorted_app_keys.sort();

    let mut app_cache: HashMap<String, ParsedAppProgram> = HashMap::new();

    let mut catalog_products = Vec::new();

    for block in hw_blocks {
        let preferred_app_ref = block.app_refs.first().cloned().unwrap_or_default();

        for raw in block.products {
            let display_name = if let Some((_, text)) = translations.get(&raw.id) {
                text.clone()
            } else if !raw.text.is_empty() {
                raw.text.clone()
            } else {
                block.name.clone()
            };

            // Find associated ApplicationProgram XML deterministically
            let mut matched_app_key = None;
            for key in &sorted_app_keys {
                if !preferred_app_ref.is_empty() && (key.contains(&preferred_app_ref) || app_xmls.get(key).map(|c| c.contains(&preferred_app_ref)).unwrap_or(false)) {
                    matched_app_key = Some(key.clone());
                    break;
                }
            }
            if matched_app_key.is_none() && !sorted_app_keys.is_empty() {
                matched_app_key = Some(sorted_app_keys[0].clone());
            }

            let mut cos = Vec::new();
            let mut params = Vec::new();
            let mut assign_rules = Vec::new();
            let mut mask_version = "07B0h (System B)".to_string();
            let mut app_program_name = format!("Applikationsprogramm {}", raw.order_number);

            if let Some(ref app_key) = matched_app_key {
                if let Some(content) = app_xmls.get(app_key) {
                    if !app_cache.contains_key(app_key) {
                        let parsed = parse_app_program_xml(content);
                        app_cache.insert(app_key.clone(), parsed);
                    }
                    if let Some((c, p, m, n, _ptp, a)) = app_cache.get(app_key) {
                        cos = c.clone();
                        params = p.clone();
                        assign_rules = a.clone();
                        if let Some(ref mv) = m {
                            mask_version = mv.clone();
                        }
                        if let Some(ref an) = n {
                            app_program_name = an.clone();
                        }
                    }
                }
            }

            let channels = infer_channels_from_product(&raw.order_number, &display_name, &cos);

            catalog_products.push(CatalogProduct {
                id: raw.id,
                order_number: raw.order_number,
                manufacturer: manufacturer_name.clone(),
                name: display_name,
                hardware_name: block.name.clone(),
                application_program: app_program_name,
                mask_version,
                bus_current_ma: block.bus_current,
                default_channels: channels,
                communication_objects: cos,
                parameters: params,
                assign_rules,
            });
        }
    }

    Ok(catalog_products)
}

/// Helper to clean template strings and HTML entities in KNX XML like "{{ChNo}}" or "{{0:Jalousie}}" or "&quot;"
fn clean_knx_template(text: &str) -> String {
    let mut s = text.to_string();
    s = s.replace("&quot;", "\"");
    s = s.replace("&amp;", "&");
    s = s.replace("&lt;", "<");
    s = s.replace("&gt;", ">");
    s = s.replace("&nbsp;", " ");
    s = s.replace("{{ChNo}}", "").replace("{{Channel}}", "");

    // Replace {{index:fallback_text}} with fallback_text, or strip {{index}}
    while let Some(start) = s.find("{{") {
        if let Some(end) = s[start..].find("}}") {
            let full_end = start + end + 2;
            let inner = &s[start + 2..start + end];
            if let Some(colon_pos) = inner.find(':') {
                let default_val = &inner[colon_pos + 1..];
                s = format!("{}{}{}", &s[..start], default_val, &s[full_end..]);
            } else {
                s = format!("{}{}", &s[..start], &s[full_end..]);
            }
        } else {
            break;
        }
    }

    // Clean multiple spaces and trim
    let mut cleaned = String::new();
    let mut last_was_space = false;
    for c in s.trim().trim_matches(':').trim().chars() {
        if c.is_whitespace() {
            if !last_was_space {
                cleaned.push(' ');
                last_was_space = true;
            }
        } else {
            cleaned.push(c);
            last_was_space = false;
        }
    }
    cleaned
}

#[derive(Clone, Default)]
pub struct ParsedComObjectRef {
    pub ref_id: String,
    pub text: Option<String>,
    pub function_text: Option<String>,
}

pub type ParsedAppProgram = (
    Vec<CommunicationObject>,
    Vec<DeviceParameter>,
    Option<String>,
    Option<String>,
    HashMap<String, String>,
    Vec<ParameterAssignRule>,
);

pub fn parse_app_program_xml(xml: &str) -> ParsedAppProgram {
    // PASS 1: Extract translations (with progressive language priority), ParameterTypes, and ParameterRefs
    let mut reader1 = Reader::from_str(xml);
    reader1.config_mut().trim_text(true);

    let mut translations: HashMap<String, HashMap<String, (u8, String)>> = HashMap::new();
    let mut param_types: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
    let mut param_type_sizes: HashMap<String, u32> = HashMap::new();
    let mut param_type_meta: HashMap<String, ParamTypeMeta> = HashMap::new();
    let mut pref_to_param: HashMap<String, String> = HashMap::new();
    let mut pref_to_access: HashMap<String, String> = HashMap::new();
    let mut coref_to_co: HashMap<String, String> = HashMap::new();
    let mut coref_map: HashMap<String, ParsedComObjectRef> = HashMap::new();

    let mut mask_version = None;
    let mut app_name = None;

    let mut current_lang_prio: u8 = 0;
    let mut current_tr_ref = String::new();
    let mut current_pt_id = String::new();

    let mut buf = Vec::new();
    loop {
        match reader1.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag.as_str() {
                    "ApplicationProgram" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Name" {
                                app_name = Some(String::from_utf8_lossy(&attr.value).to_string());
                            } else if attr.key.as_ref() == b"MaskVersion" {
                                let m = String::from_utf8_lossy(&attr.value);
                                mask_version = Some(format!("{} (System B)", m));
                            }
                        }
                    }
                    "Language" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Identifier" {
                                let id = String::from_utf8_lossy(&attr.value);
                                current_lang_prio = get_lang_priority(&id);
                            }
                        }
                    }
                    "TranslationElement" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"RefId" {
                                current_tr_ref = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                    }
                    "Translation" if !current_tr_ref.is_empty() => {
                        let mut attr_name = String::new();
                        let mut text_val = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"AttributeName" {
                                attr_name = String::from_utf8_lossy(&attr.value).to_string();
                            } else if attr.key.as_ref() == b"Text" {
                                text_val = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        if !attr_name.is_empty() && !text_val.is_empty() {
                            let entry = translations.entry(current_tr_ref.clone()).or_default();
                            let should_insert = match entry.get(&attr_name) {
                                Some((prev_prio, _)) => current_lang_prio >= *prev_prio,
                                None => true,
                            };
                            if should_insert {
                                entry.insert(attr_name, (current_lang_prio, text_val));
                            }
                        }
                    }
                    "ParameterType" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Id" {
                                current_pt_id = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                    }
                    "TypeNumber" if !current_pt_id.is_empty() => {
                        let meta = param_type_meta.entry(current_pt_id.clone()).or_default();
                        meta.is_float = Some(false);
                        meta.type_kind = Some("number".to_string());
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"SizeInBit" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        if let Ok(sz) = s.parse::<u32>() {
                                            meta.size_in_bit = Some(sz);
                                            param_type_sizes.insert(current_pt_id.clone(), sz);
                                        }
                                    }
                                }
                                b"minInclusive" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        meta.min = s.parse::<f64>().ok();
                                    }
                                }
                                b"maxInclusive" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        meta.max = s.parse::<f64>().ok();
                                    }
                                }
                                b"Increment" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        meta.step = s.parse::<f64>().ok();
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    "TypeFloat" if !current_pt_id.is_empty() => {
                        let meta = param_type_meta.entry(current_pt_id.clone()).or_default();
                        meta.is_float = Some(true);
                        meta.type_kind = Some("float".to_string());
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"SizeInBit" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        if let Ok(sz) = s.parse::<u32>() {
                                            meta.size_in_bit = Some(sz);
                                            param_type_sizes.insert(current_pt_id.clone(), sz);
                                        }
                                    }
                                }
                                b"minInclusive" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        meta.min = s.parse::<f64>().ok();
                                    }
                                }
                                b"maxInclusive" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        meta.max = s.parse::<f64>().ok();
                                    }
                                }
                                b"Increment" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        meta.step = s.parse::<f64>().ok();
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    "TypeRestriction" | "TypeText" if !current_pt_id.is_empty() => {
                        let meta = param_type_meta.entry(current_pt_id.clone()).or_default();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"SizeInBit" {
                                if let Ok(s) = std::str::from_utf8(&attr.value) {
                                    if let Ok(sz) = s.parse::<u32>() {
                                        meta.size_in_bit = Some(sz);
                                        param_type_sizes.insert(current_pt_id.clone(), sz);
                                    }
                                }
                            }
                        }
                    }
                    "Enumeration" if !current_pt_id.is_empty() => {
                        let meta = param_type_meta.entry(current_pt_id.clone()).or_default();
                        meta.type_kind = Some("enum".to_string());
                        let mut en_id = String::new();
                        let mut en_val = String::new();
                        let mut en_text = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Id" => en_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Value" => en_val = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Text" => en_text = String::from_utf8_lossy(&attr.value).to_string(),
                                _ => {}
                            }
                        }
                        param_types
                            .entry(current_pt_id.clone())
                            .or_default()
                            .push((en_id, en_val, en_text));
                    }
                    "ParameterRef" => {
                        let mut pr_id = String::new();
                        let mut pr_ref = String::new();
                        let mut pr_access = None;
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Id" => pr_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"RefId" => pr_ref = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Access" => pr_access = Some(String::from_utf8_lossy(&attr.value).to_string()),
                                _ => {}
                            }
                        }
                        if !pr_id.is_empty() && !pr_ref.is_empty() {
                            pref_to_param.insert(pr_id.clone(), pr_ref);
                        }
                        if !pr_id.is_empty() {
                            if let Some(acc) = pr_access {
                                pref_to_access.insert(pr_id, acc);
                            }
                        }
                    }
                    "ComObjectRef" => {
                        let mut cor_id = String::new();
                        let mut cor_ref = String::new();
                        let mut cor_text = None;
                        let mut cor_func = None;
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Id" => cor_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"RefId" => cor_ref = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Text" => {
                                    let s = String::from_utf8_lossy(&attr.value).to_string();
                                    if !s.is_empty() {
                                        cor_text = Some(s);
                                    }
                                }
                                b"FunctionText" => {
                                    let s = String::from_utf8_lossy(&attr.value).to_string();
                                    if !s.is_empty() {
                                        cor_func = Some(s);
                                    }
                                }
                                _ => {}
                            }
                        }
                        if !cor_id.is_empty() && !cor_ref.is_empty() {
                            coref_to_co.insert(cor_id.clone(), cor_ref.clone());
                            coref_map.insert(
                                cor_id,
                                ParsedComObjectRef {
                                    ref_id: cor_ref,
                                    text: cor_text,
                                    function_text: cor_func,
                                },
                            );
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag.as_str() {
                    "TranslationElement" => current_tr_ref.clear(),
                    "ParameterType" => current_pt_id.clear(),
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            _ => {}
        }
        buf.clear();
    }

    let de_translations: HashMap<String, HashMap<String, String>> = translations
        .into_iter()
        .map(|(ref_id, attrs)| {
            let mapped = attrs.into_iter().map(|(attr, (_, val))| (attr, val)).collect();
            (ref_id, mapped)
        })
        .collect();

    // PASS 2: Parse CommunicationObjects, Parameters, and Dynamic hierarchy
    let mut reader2 = Reader::from_str(xml);
    reader2.config_mut().trim_text(true);

    let mut cos = Vec::new();
    let mut params_map: HashMap<String, DeviceParameter> = HashMap::new();
    let mut param_order: Vec<String> = Vec::new();

    let mut in_dynamic = false;
    let mut in_module_defs = false;
    let mut current_channel: Option<String> = None;
    let mut current_block: Option<String> = None;
    let mut current_section: Option<String> = None;
    let mut choose_stack: Vec<(String, Option<String>)> = Vec::new();
    let mut assign_rules: Vec<ParameterAssignRule> = Vec::new();

    let parse_co_from_event = |e: &quick_xml::events::BytesStart| -> Option<CommunicationObject> {
        let mut co = CommunicationObject {
            id: String::new(),
            number: 0,
            name: String::new(),
            object_text: String::new(),
            function_text: String::new(),
            dpt: String::new(),
            object_size: String::new(),
            flags: ComObjectFlags::default(),
            group_address_ids: vec![],
            group_addresses: vec![],
            depends_on: None,
        };

        for attr in e.attributes().flatten() {
            match attr.key.as_ref() {
                b"Id" => co.id = String::from_utf8_lossy(&attr.value).to_string(),
                b"Number" => {
                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                        co.number = s.parse::<u32>().unwrap_or(0);
                    }
                }
                b"Name" => co.name = String::from_utf8_lossy(&attr.value).to_string(),
                b"Text" => co.object_text = String::from_utf8_lossy(&attr.value).to_string(),
                b"FunctionText" => co.function_text = String::from_utf8_lossy(&attr.value).to_string(),
                b"ObjectSize" => co.object_size = String::from_utf8_lossy(&attr.value).to_string(),
                b"DatapointType" => {
                    let raw_dpt = String::from_utf8_lossy(&attr.value);
                    co.dpt = format_knxprod_dpt(&raw_dpt);
                }
                b"CommunicationFlag" => co.flags.communication = attr.value.as_ref() == b"Enabled",
                b"ReadFlag" => co.flags.read = attr.value.as_ref() == b"Enabled",
                b"WriteFlag" => co.flags.write = attr.value.as_ref() == b"Enabled",
                b"TransmitFlag" => co.flags.transmit = attr.value.as_ref() == b"Enabled",
                b"UpdateFlag" => co.flags.update = attr.value.as_ref() == b"Enabled",
                _ => {}
            }
        }

        if !co.id.is_empty() {
            Some(co)
        } else {
            None
        }
    };

    let handle_com_object_ref_ref = |e: &quick_xml::events::BytesStart,
                                     cos: &mut Vec<CommunicationObject>,
                                     coref_map: &HashMap<String, ParsedComObjectRef>,
                                     coref_to_co: &HashMap<String, String>,
                                     de_trans: &HashMap<String, HashMap<String, String>>,
                                     choose_stack: &[(String, Option<String>)]| {
        let mut corref_id = String::new();
        for attr in e.attributes().flatten() {
            if attr.key.as_ref() == b"RefId" {
                corref_id = String::from_utf8_lossy(&attr.value).to_string();
            }
        }
        if corref_id.is_empty() {
            return;
        }

        let target_co_id = coref_to_co.get(&corref_id).cloned().unwrap_or_else(|| {
            if let Some(pos) = corref_id.rfind("_R-") {
                corref_id[..pos].to_string()
            } else {
                corref_id.clone()
            }
        });

        let active_conditions: Vec<ParameterCondition> = choose_stack
            .iter()
            .filter_map(|(pid, val_opt)| {
                val_opt.as_ref().map(|v| ParameterCondition {
                    param_id: pid.clone(),
                    when_values: vec![v.clone()],
                })
            })
            .collect();

        if let Some(co) = cos.iter_mut().find(|c| c.id == target_co_id || c.id == corref_id) {
            if let Some(txt) = de_trans.get(&corref_id).and_then(|m| m.get("Text")) {
                let clean = clean_knx_template(txt);
                if !clean.is_empty() {
                    co.object_text = clean;
                }
            } else if let Some(cor) = coref_map.get(&corref_id) {
                if let Some(ref t) = cor.text {
                    let clean = clean_knx_template(t);
                    if !clean.is_empty() {
                        co.object_text = clean;
                    }
                }
            }

            if let Some(ftxt) = de_trans.get(&corref_id).and_then(|m| m.get("FunctionText")) {
                let clean = clean_knx_template(ftxt);
                if !clean.is_empty() {
                    co.function_text = clean;
                }
            } else if let Some(cor) = coref_map.get(&corref_id) {
                if let Some(ref ft) = cor.function_text {
                    let clean = clean_knx_template(ft);
                    if !clean.is_empty() {
                        co.function_text = clean;
                    }
                }
            }

            if !active_conditions.is_empty() {
                if let Some(last_cond) = active_conditions.last() {
                    if let Some(ref mut dep) = co.depends_on {
                        if dep.param_id == last_cond.param_id {
                            for v in &last_cond.when_values {
                                if !dep.when_values.contains(v) {
                                    dep.when_values.push(v.clone());
                                }
                            }
                        }
                        for ac in &active_conditions {
                            if let Some(existing_cond) = dep.conditions.iter_mut().find(|c| c.param_id == ac.param_id) {
                                for v in &ac.when_values {
                                    if !existing_cond.when_values.contains(v) {
                                        existing_cond.when_values.push(v.clone());
                                    }
                                }
                            } else {
                                dep.conditions.push(ac.clone());
                            }
                        }
                    } else {
                        co.depends_on = Some(ParameterDependency {
                            param_id: last_cond.param_id.clone(),
                            when_values: last_cond.when_values.clone(),
                            conditions: active_conditions,
                        });
                    }
                }
            }
        }
    };

    let parse_param_from_event = |e: &quick_xml::events::BytesStart,
                                  de_trans: &HashMap<String, HashMap<String, String>>,
                                  pt_map: &HashMap<String, Vec<(String, String, String)>>,
                                  pt_meta: &HashMap<String, ParamTypeMeta>|
     -> Option<(DeviceParameter, String, Option<u32>, Option<u8>)> {
        let mut p_id = String::new();
        let mut p_name = String::new();
        let mut p_text = String::new();
        let mut p_val = String::new();
        let mut p_suffix = None;
        let mut pt_id = String::new();
        let mut p_access = String::new();
        let mut p_offset: Option<u32> = None;
        let mut p_bit_offset: Option<u8> = None;

        for attr in e.attributes().flatten() {
            match attr.key.as_ref() {
                b"Id" => p_id = String::from_utf8_lossy(&attr.value).to_string(),
                b"Name" => p_name = String::from_utf8_lossy(&attr.value).to_string(),
                b"Text" => p_text = String::from_utf8_lossy(&attr.value).to_string(),
                b"Access" => p_access = String::from_utf8_lossy(&attr.value).to_string(),
                b"Value" => {
                    p_val = String::from_utf8_lossy(&attr.value).to_string();
                }
                b"SuffixText" => {
                    let s = String::from_utf8_lossy(&attr.value).trim().to_string();
                    if !s.is_empty() {
                        p_suffix = Some(s);
                    }
                }
                b"ParameterType" => {
                    pt_id = String::from_utf8_lossy(&attr.value).to_string();
                }
                b"Offset" => {
                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                        p_offset = s.parse::<u32>().ok();
                    }
                }
                b"BitOffset" => {
                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                        p_bit_offset = s.parse::<u8>().ok();
                    }
                }
                _ => {}
            }
        }

        if p_id.is_empty() {
            return None;
        }

        let trans_text = de_trans
            .get(&p_id)
            .and_then(|m| m.get("Text"))
            .cloned()
            .unwrap_or_else(|| {
                if !p_text.is_empty() {
                    p_text.clone()
                } else if !p_name.is_empty() {
                    p_name
                        .strip_prefix("Param_")
                        .unwrap_or(&p_name)
                        .replace('_', " ")
                } else {
                    p_id.clone()
                }
            });
        let clean_text = clean_knx_template(&trans_text);

        let mut enum_opts = Vec::new();
        let mut legacy_opts = Vec::new();
        if let Some(opts) = pt_map.get(&pt_id) {
            for (en_id, en_val, en_raw) in opts {
                let en_tr = de_trans
                    .get(en_id)
                    .and_then(|m| m.get("Text"))
                    .cloned()
                    .unwrap_or_else(|| en_raw.clone());
                let clean_en = clean_knx_template(&en_tr);
                legacy_opts.push(clean_en.clone());
                enum_opts.push(ParameterOption {
                    value: en_val.clone(),
                    text: clean_en,
                });
            }
        }

        let (min, max, step, is_float) = if let Some(meta) = pt_meta.get(&pt_id) {
            let min = meta.min;
            let max = meta.max;
            let mut step = meta.step;
            let mut is_fl = meta.is_float;

            if let Some(ref sfx) = p_suffix {
                let sfx_clean = sfx.trim().to_lowercase();
                if sfx_clean == "s" || sfx_clean == "sek" || sfx_clean == "sekunden" || sfx_clean == "sec"
                    || sfx_clean == "min" || sfx_clean == "minuten" || sfx_clean == "m"
                    || sfx_clean == "h" || sfx_clean == "std" || sfx_clean == "stunden"
                    || sfx_clean == "ms" || sfx_clean == "millisekunden"
                    || sfx_clean == "%" || sfx_clean == "prozent" {
                    is_fl = Some(false);
                    if step.is_none() || step.unwrap_or(1.0) < 1.0 {
                        step = Some(1.0);
                    }
                }
            }
            (min, max, step, is_fl)
        } else {
            let mut is_fl = None;
            let mut step = None;
            if let Some(ref sfx) = p_suffix {
                let sfx_clean = sfx.trim().to_lowercase();
                if sfx_clean == "s" || sfx_clean == "sek" || sfx_clean == "sekunden" || sfx_clean == "sec"
                    || sfx_clean == "min" || sfx_clean == "minuten" || sfx_clean == "m"
                    || sfx_clean == "h" || sfx_clean == "std" || sfx_clean == "stunden"
                    || sfx_clean == "ms" || sfx_clean == "millisekunden"
                    || sfx_clean == "%" || sfx_clean == "prozent" {
                    is_fl = Some(false);
                    step = Some(1.0);
                }
            }
            (None, None, step, is_fl)
        };

        let param_type = if !enum_opts.is_empty() {
            "enum".to_string()
        } else if pt_id.contains("Enable") || pt_id.contains("Binary") {
            "boolean".to_string()
        } else if let Some(meta) = pt_meta.get(&pt_id) {
            if meta.type_kind.as_deref() == Some("float") {
                "float".to_string()
            } else if meta.type_kind.as_deref() == Some("number") {
                "number".to_string()
            } else if meta.type_kind.as_deref() == Some("text") {
                "text".to_string()
            } else if pt_id.contains("Number") || pt_id.contains("Time") || pt_id.contains("Val") {
                "number".to_string()
            } else {
                "text".to_string()
            }
        } else if pt_id.contains("Number") || pt_id.contains("Time") || pt_id.contains("Val") {
            "number".to_string()
        } else {
            "text".to_string()
        };

        let has_real_text = de_trans.get(&p_id).and_then(|m| m.get("Text")).is_some() || !p_text.is_empty();
        let is_dummy = p_name.to_lowercase().starts_with("dummy") || p_text.to_lowercase().starts_with("dummy");
        let is_internal = p_access == "None"
            || is_dummy
            || (!has_real_text && (p_name.contains('_') || p_name.starts_with("logic_") || p_name.starts_with("SetInvisible") || p_name.starts_with("GlobalSwitch") || p_name.starts_with("HWT") || p_name.starts_with("OM_")));

        let access = if is_internal {
            Some("None".to_string())
        } else if !p_access.is_empty() {
            Some(p_access)
        } else {
            None
        };

        Some((
            DeviceParameter {
                id: p_id,
                name: p_name,
                text: clean_text,
                param_type,
                value: p_val.clone(),
                default_value: p_val,
                suffix: p_suffix,
                options: legacy_opts,
                enum_options: enum_opts,
                page: None,
                pages: Vec::new(),
                section: None,
                depends_on: None,
                access,
                offset: None,
                bit_offset: None,
                size_in_bit: None,
                min,
                max,
                step,
                is_float,
            },
            pt_id,
            p_offset,
            p_bit_offset,
        ))
    };

    #[derive(Default, Clone)]
    struct ActiveUnion {
        size_in_bit: Option<u32>,
        offset: Option<u32>,
        bit_offset: Option<u8>,
    }

    let mut current_union: Option<ActiveUnion> = None;
    let mut current_param_id: Option<String> = None;
    let mut param_to_pt: HashMap<String, String> = HashMap::new();

    buf.clear();
    loop {
        match reader2.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag.as_str() {
                    "ModuleDefs" => in_module_defs = true,
                    "Dynamic" if !in_module_defs => in_dynamic = true,
                    "Channel" if in_dynamic => {
                        let mut ch_id = String::new();
                        let mut ch_text = String::new();
                        let mut ch_name = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Id" => ch_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Text" => ch_text = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Name" => ch_name = String::from_utf8_lossy(&attr.value).to_string(),
                                _ => {}
                            }
                        }
                        let raw = de_translations
                            .get(&ch_id)
                            .and_then(|m| m.get("Text"))
                            .cloned()
                            .unwrap_or(if !ch_text.is_empty() { ch_text } else { ch_name });
                        let clean = clean_knx_template(&raw);
                        current_channel = if clean.is_empty() { None } else { Some(clean) };
                        current_block = None;
                        current_section = None;
                    }
                    "ChannelIndependentBlock" if in_dynamic => {
                        current_channel = None;
                        current_block = None;
                        current_section = None;
                    }
                    "ParameterBlock" if in_dynamic => {
                        let mut pb_id = String::new();
                        let mut pb_text = String::new();
                        let mut pb_name = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Id" => pb_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Text" => pb_text = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Name" => pb_name = String::from_utf8_lossy(&attr.value).to_string(),
                                _ => {}
                            }
                        }
                        let raw = de_translations
                            .get(&pb_id)
                            .and_then(|m| m.get("Text"))
                            .cloned()
                            .unwrap_or(if !pb_text.is_empty() { pb_text } else { pb_name });
                        let clean = clean_knx_template(&raw);
                        if !clean.is_empty() {
                            current_block = Some(clean);
                        }
                        current_section = None;
                    }
                    "ParameterSeparator" if in_dynamic => {
                        let mut sep_id = String::new();
                        let mut sep_text = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Id" => sep_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Text" => sep_text = String::from_utf8_lossy(&attr.value).to_string(),
                                _ => {}
                            }
                        }
                        let raw = de_translations
                            .get(&sep_id)
                            .and_then(|m| m.get("Text"))
                            .cloned()
                            .unwrap_or(sep_text);
                        let clean = raw.trim().to_string();
                        if !clean.is_empty() {
                            current_section = Some(clean);
                        }
                    }
                    "choose" if in_dynamic => {
                        let mut pref_id = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"ParamRefId" {
                                pref_id = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        let param_id = pref_to_param.get(&pref_id).cloned().unwrap_or(pref_id);
                        choose_stack.push((param_id, None));
                    }
                    "when" if in_dynamic => {
                        let mut test_val = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"test" {
                                test_val = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        if let Some(top) = choose_stack.last_mut() {
                            top.1 = Some(test_val);
                        }
                    }
                    "Assign" if in_dynamic => {
                        let mut target_ref = String::new();
                        let mut source_ref = String::new();
                        let mut val_attr = None;
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"TargetParamRefRef" => target_ref = String::from_utf8_lossy(&attr.value).to_string(),
                                b"SourceParamRefRef" => source_ref = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Value" => val_attr = Some(String::from_utf8_lossy(&attr.value).to_string()),
                                _ => {}
                            }
                        }
                        if !target_ref.is_empty() {
                            let target_id = pref_to_param.get(&target_ref).cloned().unwrap_or_else(|| {
                                if let Some(pos) = target_ref.rfind("_R-") {
                                    target_ref[..pos].to_string()
                                } else {
                                    target_ref.clone()
                                }
                            });
                            let source_id = if !source_ref.is_empty() {
                                Some(pref_to_param.get(&source_ref).cloned().unwrap_or_else(|| {
                                    if let Some(pos) = source_ref.rfind("_R-") {
                                        source_ref[..pos].to_string()
                                    } else {
                                        source_ref.clone()
                                    }
                                }))
                            } else {
                                None
                            };

                            let active_conditions: Vec<ParameterCondition> = choose_stack
                                .iter()
                                .filter_map(|(pid, val_opt)| {
                                    val_opt.as_ref().map(|v| ParameterCondition {
                                        param_id: pid.clone(),
                                        when_values: vec![v.clone()],
                                    })
                                })
                                .collect();

                            assign_rules.push(ParameterAssignRule {
                                target_param_id: target_id,
                                source_param_id: source_id,
                                value: val_attr,
                                conditions: active_conditions,
                            });
                        }
                    }
                    "Union" => {
                        let mut sz_bit = None;
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"SizeInBit" {
                                if let Ok(s) = std::str::from_utf8(&attr.value) {
                                    sz_bit = s.parse::<u32>().ok();
                                }
                            }
                        }
                        current_union = Some(ActiveUnion {
                            size_in_bit: sz_bit,
                            offset: None,
                            bit_offset: None,
                        });
                    }
                    "Memory" => {
                        let mut m_offset = None;
                        let mut m_bit_offset = None;
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Offset" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        m_offset = s.parse::<u32>().ok();
                                    }
                                }
                                b"BitOffset" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        m_bit_offset = s.parse::<u8>().ok();
                                    }
                                }
                                _ => {}
                            }
                        }
                        if let Some(ref pid) = current_param_id {
                            if let Some(p) = params_map.get_mut(pid) {
                                p.offset = m_offset;
                                p.bit_offset = m_bit_offset.or(Some(0));
                                if p.size_in_bit.is_none() {
                                    if let Some(ptid) = param_to_pt.get(pid) {
                                        p.size_in_bit = param_type_sizes.get(ptid).copied();
                                    }
                                }
                            }
                        } else if let Some(ref mut u) = current_union {
                            u.offset = m_offset;
                            u.bit_offset = m_bit_offset.or(Some(0));
                        }
                    }
                    "ComObject" => {
                        if let Some(mut co) = parse_co_from_event(&e) {
                            if let Some(txt) = de_translations.get(&co.id).and_then(|m| m.get("Text")) {
                                co.object_text = txt.clone();
                            }
                            if let Some(ftxt) = de_translations.get(&co.id).and_then(|m| m.get("FunctionText")) {
                                co.function_text = ftxt.clone();
                            }
                            cos.push(co);
                        }
                    }
                    "Parameter" => {
                        if let Some((mut p, pt_id, attr_offset, attr_bit_offset)) = parse_param_from_event(&e, &de_translations, &param_types, &param_type_meta) {
                            let final_offset = match (current_union.as_ref().and_then(|u| u.offset), attr_offset) {
                                (Some(u_off), Some(p_off)) => Some(u_off + p_off),
                                (Some(u_off), None) => Some(u_off),
                                (None, Some(p_off)) => Some(p_off),
                                (None, None) => None,
                            };
                            let final_bit_offset = match (current_union.as_ref().and_then(|u| u.bit_offset), attr_bit_offset) {
                                (Some(u_bit), Some(p_bit)) => Some(u_bit + p_bit),
                                (Some(u_bit), None) => Some(u_bit),
                                (None, Some(p_bit)) => Some(p_bit),
                                (None, None) => None,
                            };
                            let final_size = current_union.as_ref().and_then(|u| u.size_in_bit)
                                .or_else(|| param_type_sizes.get(&pt_id).copied());

                            p.offset = final_offset;
                            p.bit_offset = final_bit_offset;
                            p.size_in_bit = final_size;

                            let pid = p.id.clone();
                            current_param_id = Some(pid.clone());
                            param_to_pt.insert(pid.clone(), pt_id);
                            param_order.push(pid.clone());
                            params_map.insert(pid, p);
                        }
                    }
                    "ComObjectRefRef" if in_dynamic => {
                        handle_com_object_ref_ref(&e, &mut cos, &coref_map, &coref_to_co, &de_translations, &choose_stack);
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag.as_str() {
                    "ParameterRefRef" if in_dynamic => {
                        let mut pref_id = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"RefId" {
                                pref_id = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                        let p_id = pref_to_param.get(&pref_id).cloned().unwrap_or_else(|| {
                            // Fallback: strip _R-... from ID if present
                            if let Some(pos) = pref_id.rfind("_R-") {
                                pref_id[..pos].to_string()
                            } else {
                                pref_id.clone()
                            }
                        });
                        let pref_access = pref_to_access.get(&pref_id).cloned();
                        if let Some(p) = params_map.get_mut(&p_id) {
                            if let Some(ref acc) = pref_access {
                                if acc == "ReadWrite" || acc == "Value" || acc == "Read" {
                                    p.access = Some(acc.clone());
                                } else if acc == "None" && p.access.is_none() {
                                    p.access = Some("None".to_string());
                                }
                            }

                            let is_ref_none = pref_access.as_deref() == Some("None");

                            if !is_ref_none {
                                let page_name_opt = match (&current_channel, &current_block) {
                                    (Some(ch), Some(pb)) => Some(format!("{} > {}", ch, pb)),
                                    (Some(ch), None) => Some(ch.clone()),
                                    (None, Some(pb)) => Some(pb.clone()),
                                    (None, None) => None,
                                };
                                if let Some(page_name) = page_name_opt {
                                    if p.page.is_none() {
                                        p.page = Some(page_name.clone());
                                    }
                                    if !p.pages.contains(&page_name) {
                                        p.pages.push(page_name);
                                    }
                                }
                                if p.section.is_none() && current_section.is_some() {
                                    p.section = current_section.clone();
                                }
                            }

                            let active_conditions: Vec<ParameterCondition> = choose_stack
                                .iter()
                                .filter_map(|(pid, val_opt)| {
                                    val_opt.as_ref().map(|v| ParameterCondition {
                                        param_id: pid.clone(),
                                        when_values: vec![v.clone()],
                                    })
                                })
                                .collect();

                            if !active_conditions.is_empty() {
                                if let Some(last_cond) = active_conditions.last() {
                                    if let Some(ref mut dep) = p.depends_on {
                                        if dep.param_id == last_cond.param_id {
                                            for v in &last_cond.when_values {
                                                if !dep.when_values.contains(v) {
                                                    dep.when_values.push(v.clone());
                                                }
                                            }
                                        }
                                        for ac in &active_conditions {
                                            if let Some(existing_cond) = dep.conditions.iter_mut().find(|c| c.param_id == ac.param_id) {
                                                for v in &ac.when_values {
                                                    if !existing_cond.when_values.contains(v) {
                                                        existing_cond.when_values.push(v.clone());
                                                    }
                                                }
                                            } else {
                                                dep.conditions.push(ac.clone());
                                            }
                                        }
                                    } else {
                                        p.depends_on = Some(ParameterDependency {
                                            param_id: last_cond.param_id.clone(),
                                            when_values: last_cond.when_values.clone(),
                                            conditions: active_conditions,
                                        });
                                    }
                                }
                            }
                        }
                    }
                    "ParameterSeparator" if in_dynamic => {
                        let mut sep_id = String::new();
                        let mut sep_text = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Id" => sep_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Text" => sep_text = String::from_utf8_lossy(&attr.value).to_string(),
                                _ => {}
                            }
                        }
                        let raw = de_translations
                            .get(&sep_id)
                            .and_then(|m| m.get("Text"))
                            .cloned()
                            .unwrap_or(sep_text);
                        let clean = raw.trim().to_string();
                        if !clean.is_empty() {
                            current_section = Some(clean);
                        }
                    }
                    "ComObject" => {
                        if let Some(mut co) = parse_co_from_event(&e) {
                            if let Some(txt) = de_translations.get(&co.id).and_then(|m| m.get("Text")) {
                                co.object_text = txt.clone();
                            }
                            if let Some(ftxt) = de_translations.get(&co.id).and_then(|m| m.get("FunctionText")) {
                                co.function_text = ftxt.clone();
                            }
                            cos.push(co);
                        }
                    }
                    "ComObjectRefRef" if in_dynamic => {
                        handle_com_object_ref_ref(&e, &mut cos, &coref_map, &coref_to_co, &de_translations, &choose_stack);
                    }
                    "Memory" => {
                        let mut m_offset = None;
                        let mut m_bit_offset = None;
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Offset" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        m_offset = s.parse::<u32>().ok();
                                    }
                                }
                                b"BitOffset" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        m_bit_offset = s.parse::<u8>().ok();
                                    }
                                }
                                _ => {}
                            }
                        }
                        if let Some(ref pid) = current_param_id {
                            if let Some(p) = params_map.get_mut(pid) {
                                p.offset = m_offset;
                                p.bit_offset = m_bit_offset.or(Some(0));
                                if p.size_in_bit.is_none() {
                                    if let Some(ptid) = param_to_pt.get(pid) {
                                        p.size_in_bit = param_type_sizes.get(ptid).copied();
                                    }
                                }
                            }
                        } else if let Some(ref mut u) = current_union {
                            u.offset = m_offset;
                            u.bit_offset = m_bit_offset.or(Some(0));
                        }
                    }
                    "Parameter" => {
                        if let Some((mut p, pt_id, attr_offset, attr_bit_offset)) = parse_param_from_event(&e, &de_translations, &param_types, &param_type_meta) {
                            let final_offset = match (current_union.as_ref().and_then(|u| u.offset), attr_offset) {
                                (Some(u_off), Some(p_off)) => Some(u_off + p_off),
                                (Some(u_off), None) => Some(u_off),
                                (None, Some(p_off)) => Some(p_off),
                                (None, None) => None,
                            };
                            let final_bit_offset = match (current_union.as_ref().and_then(|u| u.bit_offset), attr_bit_offset) {
                                (Some(u_bit), Some(p_bit)) => Some(u_bit + p_bit),
                                (Some(u_bit), None) => Some(u_bit),
                                (None, Some(p_bit)) => Some(p_bit),
                                (None, None) => None,
                            };
                            let final_size = current_union.as_ref().and_then(|u| u.size_in_bit)
                                .or_else(|| param_type_sizes.get(&pt_id).copied());

                            p.offset = final_offset;
                            p.bit_offset = final_bit_offset;
                            p.size_in_bit = final_size;

                            let pid = p.id.clone();
                            param_to_pt.insert(pid.clone(), pt_id);
                            param_order.push(pid.clone());
                            params_map.insert(pid, p);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag.as_str() {
                    "ModuleDefs" => in_module_defs = false,
                    "Dynamic" if !in_module_defs => in_dynamic = false,
                    "Channel" => {
                        current_channel = None;
                        current_block = None;
                        current_section = None;
                    }
                    "ParameterBlock" => {
                        current_block = None;
                        current_section = None;
                    }
                    "choose" => {
                        choose_stack.pop();
                    }
                    "when" => {
                        if let Some(top) = choose_stack.last_mut() {
                            top.1 = None;
                        }
                    }
                    "Parameter" => {
                        current_param_id = None;
                    }
                    "Union" => {
                        current_union = None;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            _ => {}
        }
        buf.clear();
    }

    // Assemble final parameters list: parameters assigned to pages in Dynamic first, followed by others
    let mut final_params = Vec::new();
    let mut added_ids = std::collections::HashSet::new();

    for id in &param_order {
        if let Some(p) = params_map.get(id) {
            if p.page.is_some() && added_ids.insert(id.clone()) {
                final_params.push(p.clone());
            }
        }
    }
    for id in &param_order {
        if let Some(p) = params_map.get(id) {
            if added_ids.insert(id.clone()) {
                final_params.push(p.clone());
            }
        }
    }

    cos.sort_by_key(|c| c.number);
    (cos, final_params, mask_version, app_name, pref_to_param, assign_rules)
}

pub fn infer_channels_from_product(
    order_num: &str,
    name: &str,
    _cos: &[CommunicationObject],
) -> Vec<DeviceChannel> {
    let dev_id = Uuid::nil();
    let lower_name = name.to_lowercase();
    let lower_order = order_num.to_lowercase();

    if lower_name.contains("jalousie") || lower_order.contains("jal") {
        let count = if lower_order.contains("04") || lower_name.contains("4-fach") {
            4
        } else if lower_order.contains("08") || lower_name.contains("8-fach") {
            8
        } else {
            1
        };

        (0..count)
            .map(|i| {
                let code_letter = (b'A' + i as u8) as char;
                DeviceChannel {
                    id: Uuid::new_v4(),
                    device_id: dev_id,
                    channel_code: format!("Kanal {}", code_letter),
                    name: format!("Jalousie/Rollo {}", code_letter),
                    channel_type: ChannelType::BlindOutput,
                    room_id: None,
                    position: None,
                }
            })
            .collect()
    } else if lower_name.contains("dimm") || lower_order.contains("akd") {
        let count = if lower_order.contains("04") || lower_name.contains("4-fach") {
            4
        } else if lower_order.contains("02") || lower_name.contains("2-fach") {
            2
        } else {
            4
        };

        (0..count)
            .map(|i| {
                let code_letter = (b'A' + i as u8) as char;
                DeviceChannel {
                    id: Uuid::new_v4(),
                    device_id: dev_id,
                    channel_code: format!("Kanal {}", code_letter),
                    name: format!("Dimmer LED {}", code_letter),
                    channel_type: ChannelType::DimmerOutput,
                    room_id: None,
                    position: None,
                }
            })
            .collect()
    } else if lower_name.contains("taster") || lower_order.contains("be-gt") {
        (1..=4)
            .map(|i| DeviceChannel {
                id: Uuid::new_v4(),
                device_id: dev_id,
                channel_code: format!("Taste {}", i),
                name: format!("Tastenfunktion {}", i),
                channel_type: ChannelType::PushButtonInput,
                room_id: None,
                position: None,
            })
            .collect()
    } else if lower_name.contains("heiz") || lower_order.contains("akh") || lower_name.contains("ventil") {
        let count = if lower_order.contains("08") || lower_name.contains("8-fach") {
            8
        } else if lower_order.contains("04") || lower_name.contains("4-fach") {
            4
        } else if lower_order.contains("06") || lower_name.contains("6-fach") {
            6
        } else {
            2
        };

        (0..count)
            .map(|i| {
                let code_letter = (b'A' + i as u8) as char;
                DeviceChannel {
                    id: Uuid::new_v4(),
                    device_id: dev_id,
                    channel_code: format!("Kanal {}", code_letter),
                    name: format!("Heizkreis {}", code_letter),
                    channel_type: ChannelType::HeatingOutput,
                    room_id: None,
                    position: None,
                }
            })
            .collect()
    } else {
        // Fallback: 2 channels
        vec![
            DeviceChannel {
                id: Uuid::new_v4(),
                device_id: dev_id,
                channel_code: "Kanal A".to_string(),
                name: "Ausgang A".to_string(),
                channel_type: ChannelType::SwitchOutput,
                room_id: None,
                position: None,
            },
            DeviceChannel {
                id: Uuid::new_v4(),
                device_id: dev_id,
                channel_code: "Kanal B".to_string(),
                name: "Ausgang B".to_string(),
                channel_type: ChannelType::SwitchOutput,
                room_id: None,
                position: None,
            },
        ]
    }
}

// ==========================================
// Catalog Manager (SQLite-backed Repository)
// ==========================================

#[derive(Clone)]
pub struct CatalogManager {
    conn: Arc<Mutex<Connection>>,
}

impl Default for CatalogManager {
    fn default() -> Self {
        Self::new()
    }
}

impl CatalogManager {
    /// Opens the persistent ~/.konfix/catalog.db SQLite database (with auto-migration from legacy JSONs)
    pub fn new() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let konfix_dir = Path::new(&home).join(".konfix");
        let _ = std::fs::create_dir_all(&konfix_dir);
        let db_path = konfix_dir.join("catalog.db");

        let conn = Connection::open(&db_path).unwrap_or_else(|e| {
            tracing::warn!("Could not open catalog.db at {:?}: {}. Falling back to in-memory DB.", db_path, e);
            Connection::open_in_memory().unwrap()
        });

        let mgr = Self::init_with_connection(conn);

        // One-time migration: check if ~/.konfix/catalog has legacy JSON files
        let legacy_catalog_dir = konfix_dir.join("catalog");
        if legacy_catalog_dir.is_dir() {
            info!("Found legacy catalog directory {:?}, migrating into SQLite catalog.db...", legacy_catalog_dir);
            if let Ok(entries) = std::fs::read_dir(&legacy_catalog_dir) {
                let mut migrated = 0;
                let conn_guard = mgr.conn.lock().unwrap();
                let _ = conn_guard.execute("BEGIN TRANSACTION", []);
                for entry in entries.flatten() {
                    let ep = entry.path();
                    if ep.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("json")).unwrap_or(false) {
                        if let Ok(content) = std::fs::read_to_string(&ep) {
                            if let Ok(prod) = serde_json::from_str::<CatalogProduct>(&content) {
                                let _ = Self::upsert_product_conn(&conn_guard, &prod);
                                migrated += 1;
                            }
                        }
                    }
                }
                let _ = conn_guard.execute("COMMIT", []);
                info!("Successfully migrated {} legacy product JSONs into SQLite catalog.db", migrated);
            }
            let backup_dir = konfix_dir.join("catalog_migrated_backup");
            let _ = std::fs::rename(&legacy_catalog_dir, &backup_dir);
        }

        // If database is empty, seed with built-in reference catalog and database/ folder
        let count: i64 = {
            let conn_guard = mgr.conn.lock().unwrap();
            conn_guard.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0)).unwrap_or(0)
        };

        if count == 0 {
            // First check if database/catalog.sql exists to seed full catalog
            let mut seeded_from_sql = false;
            let sql_candidates = [
                "database/catalog.sql",
                "../database/catalog.sql",
                "../../database/catalog.sql",
            ];
            for candidate in sql_candidates {
                if let Ok(sql_content) = std::fs::read_to_string(candidate) {
                    info!("Seeding catalog.db from {:?}...", candidate);
                    let conn_guard = mgr.conn.lock().unwrap();
                    if let Err(e) = conn_guard.execute_batch(&sql_content) {
                        tracing::warn!("Fehler beim Importieren von {:?}: {}", candidate, e);
                    } else {
                        seeded_from_sql = true;
                        info!("Katalog erfolgreich aus {:?} initialisiert.", candidate);
                    }
                    drop(conn_guard);
                    break;
                }
            }

            if !seeded_from_sql {
                info!("Seeding empty catalog.db with built-in standard KNX devices...");
                let conn_guard = mgr.conn.lock().unwrap();
                let _ = conn_guard.execute("BEGIN TRANSACTION", []);
                for prod in Self::get_built_in_catalog() {
                    let _ = Self::upsert_product_conn(&conn_guard, &prod);
                }
                let _ = conn_guard.execute("COMMIT", []);
                drop(conn_guard);
            }

            // Also scan database folders if any knxprod files exist
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread {
                    tokio::task::block_in_place(|| {
                        handle.block_on(async {
                            mgr.scan_database_folder().await;
                        });
                    });
                } else {
                    let mgr_clone = mgr.clone();
                    handle.spawn(async move {
                        mgr_clone.scan_database_folder().await;
                    });
                }
            }
        }

        mgr
    }

    /// Creates an isolated in-memory CatalogManager for unit tests
    pub fn new_in_memory() -> Self {
        let conn = Connection::open_in_memory().unwrap();
        let mgr = Self::init_with_connection(conn);
        let conn_guard = mgr.conn.lock().unwrap();
        let _ = conn_guard.execute("BEGIN TRANSACTION", []);
        for prod in Self::get_built_in_catalog() {
            let _ = Self::upsert_product_conn(&conn_guard, &prod);
        }
        let _ = conn_guard.execute("COMMIT", []);
        drop(conn_guard);
        mgr
    }

    fn init_with_connection(conn: Connection) -> Self {
        let _ = conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                order_number TEXT NOT NULL,
                manufacturer TEXT NOT NULL,
                name TEXT NOT NULL,
                hardware_name TEXT NOT NULL,
                application_program TEXT NOT NULL,
                mask_version TEXT NOT NULL,
                bus_current_ma INTEGER NOT NULL,
                channel_count INTEGER NOT NULL,
                ko_count INTEGER NOT NULL,
                param_count INTEGER NOT NULL,
                data_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_products_order ON products(order_number);
            CREATE INDEX IF NOT EXISTS idx_products_mfr ON products(manufacturer);
            CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
        ");

        Self {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    /// Helper to insert or replace a product in an active SQLite connection
    pub fn upsert_product_conn(conn: &Connection, prod: &CatalogProduct) -> Result<(), String> {
        let json = serde_json::to_string(prod).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO products (
                id, order_number, manufacturer, name, hardware_name,
                application_program, mask_version, bus_current_ma,
                channel_count, ko_count, param_count, data_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(id) DO UPDATE SET
                order_number=excluded.order_number,
                manufacturer=excluded.manufacturer,
                name=excluded.name,
                hardware_name=excluded.hardware_name,
                application_program=excluded.application_program,
                mask_version=excluded.mask_version,
                bus_current_ma=excluded.bus_current_ma,
                channel_count=excluded.channel_count,
                ko_count=excluded.ko_count,
                param_count=excluded.param_count,
                data_json=excluded.data_json",
            params![
                prod.id,
                prod.order_number,
                prod.manufacturer,
                prod.name,
                prod.hardware_name,
                prod.application_program,
                prod.mask_version,
                prod.bus_current_ma as i64,
                prod.default_channels.len() as i64,
                prod.communication_objects.len() as i64,
                prod.parameters.len() as i64,
                json,
            ],
        ).map_err(|e| format!("Fehler beim Speichern in catalog.db: {}", e))?;
        Ok(())
    }

    /// Loads built-in standard KNX devices with full KOs and parameters
    fn get_built_in_catalog() -> Vec<CatalogProduct> {
        let mut prods = Vec::new();

        // 1. MDT AKD-0424R.02 (Dimmaktor)
        prods.push(CatalogProduct {
            id: "MDT_AKD-0424R.02".to_string(),
            order_number: "AKD-0424R.02".to_string(),
            manufacturer: "MDT Technologies".to_string(),
            name: "MDT AKD-0424R.02 4-fach Dimmaktor 24V CV".to_string(),
            hardware_name: "AKD-0424R.02 LED Dimmaktor 4-Kanal".to_string(),
            application_program: "Dimmaktor 4-fach 24V V2.1".to_string(),
            mask_version: "07B0h (System B)".to_string(),
            bus_current_ma: 10,
            default_channels: vec![
                DeviceChannel {
                    id: Uuid::new_v4(),
                    device_id: Uuid::nil(),
                    channel_code: "Kanal A".to_string(),
                    name: "Dimmer LED A".to_string(),
                    channel_type: ChannelType::DimmerOutput,
                    room_id: None,
                    position: None,
                },
                DeviceChannel {
                    id: Uuid::new_v4(),
                    device_id: Uuid::nil(),
                    channel_code: "Kanal B".to_string(),
                    name: "Dimmer LED B".to_string(),
                    channel_type: ChannelType::DimmerOutput,
                    room_id: None,
                    position: None,
                },
                DeviceChannel {
                    id: Uuid::new_v4(),
                    device_id: Uuid::nil(),
                    channel_code: "Kanal C".to_string(),
                    name: "Dimmer LED C".to_string(),
                    channel_type: ChannelType::DimmerOutput,
                    room_id: None,
                    position: None,
                },
                DeviceChannel {
                    id: Uuid::new_v4(),
                    device_id: Uuid::nil(),
                    channel_code: "Kanal D".to_string(),
                    name: "Dimmer LED D".to_string(),
                    channel_type: ChannelType::DimmerOutput,
                    room_id: None,
                    position: None,
                },
            ],
            communication_objects: vec![
                CommunicationObject {
                    id: "AKD_0".to_string(),
                    number: 0,
                    name: "ChA_Switch".to_string(),
                    object_text: "Kanal A".to_string(),
                    function_text: "Schalten Ein/Aus".to_string(),
                    dpt: "1.001".to_string(),
                    object_size: "1 Bit".to_string(),
                    flags: ComObjectFlags::default(),
                    group_address_ids: vec![],
                    group_addresses: vec![],
                    depends_on: None,
                },
                CommunicationObject {
                    id: "AKD_1".to_string(),
                    number: 1,
                    name: "ChA_DimRel".to_string(),
                    object_text: "Kanal A".to_string(),
                    function_text: "Dimmen relativ".to_string(),
                    dpt: "3.007".to_string(),
                    object_size: "4 Bit".to_string(),
                    flags: ComObjectFlags::default(),
                    group_address_ids: vec![],
                    group_addresses: vec![],
                    depends_on: None,
                },
                CommunicationObject {
                    id: "AKD_2".to_string(),
                    number: 2,
                    name: "ChA_DimAbs".to_string(),
                    object_text: "Kanal A".to_string(),
                    function_text: "Dimmwert absolut".to_string(),
                    dpt: "5.001".to_string(),
                    object_size: "1 Byte".to_string(),
                    flags: ComObjectFlags::default(),
                    group_address_ids: vec![],
                    group_addresses: vec![],
                    depends_on: None,
                },
                CommunicationObject {
                    id: "AKD_3".to_string(),
                    number: 3,
                    name: "ChA_StateSwitch".to_string(),
                    object_text: "Kanal A".to_string(),
                    function_text: "Status Schalten".to_string(),
                    dpt: "1.001".to_string(),
                    object_size: "1 Bit".to_string(),
                    flags: ComObjectFlags {
                        communication: true,
                        read: true,
                        write: false,
                        transmit: true,
                        update: false,
                    },
                    group_address_ids: vec![],
                    group_addresses: vec![],
                    depends_on: None,
                },
            ],
            parameters: vec![
                DeviceParameter {
                    id: "AKD_P1".to_string(),
                    name: "fade_time_sec".to_string(),
                    text: "Dimmgeschwindigkeit (Überblendzeit)".to_string(),
                    param_type: "number".to_string(),
                    value: "1.5".to_string(),
                    default_value: "2.0".to_string(),
                    suffix: Some("s".to_string()),
                    options: vec![],
                    enum_options: vec![],
                    page: Some("Allgemeine Einstellung".to_string()),
                    pages: vec![],
                    section: Some("Dimmkurve".to_string()),
                    depends_on: None,
                    access: None,
                    offset: None,
                    bit_offset: None,
                    size_in_bit: None,
                    min: Some(0.0),
                    max: Some(60.0),
                    step: Some(0.5),
                    is_float: Some(true),
                },
                DeviceParameter {
                    id: "AKD_P2".to_string(),
                    name: "default_brightness".to_string(),
                    text: "Einschalt-Helligkeit (%)".to_string(),
                    param_type: "number".to_string(),
                    value: "80".to_string(),
                    default_value: "100".to_string(),
                    suffix: Some("%".to_string()),
                    options: vec![],
                    enum_options: vec![],
                    page: Some("Allgemeine Einstellung".to_string()),
                    pages: vec![],
                    section: Some("Einschaltverhalten".to_string()),
                    depends_on: None,
                    access: None,
                    offset: None,
                    bit_offset: None,
                    size_in_bit: None,
                    min: Some(0.0),
                    max: Some(100.0),
                    step: Some(1.0),
                    is_float: Some(false),
                },
            ],
            assign_rules: vec![],
        });

        // 2. MDT BE-GT20W.02 (Glastaster II Smart)
        prods.push(CatalogProduct {
            id: "MDT_BE-GT20W.02".to_string(),
            order_number: "BE-GT20W.02".to_string(),
            manufacturer: "MDT Technologies".to_string(),
            name: "MDT Glastaster II Smart mit Farbdisplay".to_string(),
            hardware_name: "Glastaster II Smart".to_string(),
            application_program: "Glastaster II Smart V2.4".to_string(),
            mask_version: "07B0h (System B)".to_string(),
            bus_current_ma: 15,
            default_channels: (1..=4)
                .map(|i| DeviceChannel {
                    id: Uuid::new_v4(),
                    device_id: Uuid::nil(),
                    channel_code: format!("Taste {}", i),
                    name: format!("Tastenfunktion {}", i),
                    channel_type: ChannelType::PushButtonInput,
                    room_id: None,
                    position: None,
                })
                .collect(),
            communication_objects: vec![
                CommunicationObject {
                    id: "GT_0".to_string(),
                    number: 0,
                    name: "T1_Switch".to_string(),
                    object_text: "Taste 1".to_string(),
                    function_text: "Schalten Ein/Aus".to_string(),
                    dpt: "1.001".to_string(),
                    object_size: "1 Bit".to_string(),
                    flags: ComObjectFlags {
                        communication: true,
                        read: false,
                        write: false,
                        transmit: true,
                        update: true,
                    },
                    group_address_ids: vec![],
                    group_addresses: vec![],
                    depends_on: None,
                },
                CommunicationObject {
                    id: "GT_1".to_string(),
                    number: 1,
                    name: "T2_Move".to_string(),
                    object_text: "Taste 2".to_string(),
                    function_text: "Jalousie Auf/Ab".to_string(),
                    dpt: "1.008".to_string(),
                    object_size: "1 Bit".to_string(),
                    flags: ComObjectFlags {
                        communication: true,
                        read: false,
                        write: false,
                        transmit: true,
                        update: true,
                    },
                    group_address_ids: vec![],
                    group_addresses: vec![],
                    depends_on: None,
                },
            ],
            parameters: vec![
                DeviceParameter {
                    id: "GT_P1".to_string(),
                    name: "display_brightness".to_string(),
                    text: "Display-Helligkeit aktiv".to_string(),
                    param_type: "number".to_string(),
                    value: "80".to_string(),
                    default_value: "70".to_string(),
                    suffix: Some("%".to_string()),
                    options: vec![],
                    enum_options: vec![],
                    page: Some("Display & Tasten".to_string()),
                    pages: vec![],
                    section: Some("Helligkeit".to_string()),
                    depends_on: None,
                    access: None,
                    offset: None,
                    bit_offset: None,
                    size_in_bit: None,
                    min: Some(0.0),
                    max: Some(100.0),
                    step: Some(1.0),
                    is_float: Some(false),
                },
            ],
            assign_rules: vec![],
        });

        prods
    }

    /// Returns lightweight product summaries (instant UI queries, < 1ms)
    pub async fn get_all_summaries(&self) -> Vec<CatalogProductSummary> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, order_number, manufacturer, name, hardware_name,
                    application_program, mask_version, bus_current_ma,
                    channel_count, ko_count, param_count
             FROM products
             ORDER BY manufacturer ASC, name ASC"
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map([], |row| {
            Ok(CatalogProductSummary {
                id: row.get(0)?,
                order_number: row.get(1)?,
                manufacturer: row.get(2)?,
                name: row.get(3)?,
                hardware_name: row.get(4)?,
                application_program: row.get(5)?,
                mask_version: row.get(6)?,
                bus_current_ma: row.get::<_, i64>(7)? as u16,
                channel_count: row.get::<_, i64>(8)? as usize,
                ko_count: row.get::<_, i64>(9)? as usize,
                param_count: row.get::<_, i64>(10)? as usize,
            })
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(|r| r.ok()).collect()
    }

    /// Recursively scans database folders and imports all knxprod products into catalog.db (ignoring legacy .vd4)
    pub async fn scan_database_folder(&self) -> usize {
        let candidates = [
            "database/mdt",
            "database",
        ];

        let mut loaded_count = 0;
        let mut all_new_products = Vec::new();

        for path_str in candidates {
            let p = Path::new(path_str);
            if p.is_dir() {
                if let Ok(entries) = std::fs::read_dir(p) {
                    for entry in entries.flatten() {
                        let ep = entry.path();
                        if let Some(ext) = ep.extension().and_then(|e| e.to_str()) {
                            if ext.eq_ignore_ascii_case("knxprod") {
                                if let Ok(bytes) = std::fs::read(&ep) {
                                    if let Ok(parsed) = parse_knxprod(&bytes) {
                                        loaded_count += parsed.len();
                                        all_new_products.extend(parsed);
                                    }
                                }
                            }
                        }
                    }
                }
            } else if p.exists() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("knxprod") {
                        if let Ok(bytes) = std::fs::read(p) {
                            if let Ok(parsed) = parse_knxprod(&bytes) {
                                loaded_count += parsed.len();
                                all_new_products.extend(parsed);
                            }
                        }
                    }
                }
            }
        }

        if !all_new_products.is_empty() {
            let conn = self.conn.lock().unwrap();
            let _ = conn.execute("BEGIN TRANSACTION", []);
            for prod in &all_new_products {
                let _ = Self::upsert_product_conn(&conn, prod);
            }
            let _ = conn.execute("COMMIT", []);
            info!("Upserted {} products into SQLite catalog.db", all_new_products.len());
        }

        loaded_count
    }

    /// Normalizes a product order number or model code for robust matching
    pub fn normalize_code(code: &str) -> String {
        code.trim()
            .to_uppercase()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect()
    }

    /// Finds a catalog product matching a project device by order_number or model
    pub async fn find_matching_product(&self, device: &KnxDevice) -> Option<CatalogProduct> {
        let conn = self.conn.lock().unwrap();

        // 1. Direct indexed match on order_number
        if let Some(ref order) = device.order_number {
            let clean_order = order.trim();
            if !clean_order.is_empty() {
                if let Ok(mut stmt) = conn.prepare("SELECT data_json FROM products WHERE order_number = ?1 LIMIT 1") {
                    if let Ok(json) = stmt.query_row(params![clean_order], |r| r.get::<_, String>(0)) {
                        if let Ok(prod) = serde_json::from_str::<CatalogProduct>(&json) {
                            return Some(prod);
                        }
                    }
                }
            }
        }

        // 2. Scan (id, order_number) using normalized code without parsing JSON blobs
        let mut stmt = match conn.prepare("SELECT id, order_number FROM products") {
            Ok(s) => s,
            Err(_) => return None,
        };
        let rows = match stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
            Ok(r) => r,
            Err(_) => return None,
        };

        let norm_order = device.order_number.as_ref().map(|o| Self::normalize_code(o)).unwrap_or_default();
        let norm_model = Self::normalize_code(&device.model);
        let mut matched_id = None;

        for row in rows.flatten() {
            let (p_id, p_order) = row;
            let norm_p_order = Self::normalize_code(&p_order);
            let norm_p_id = Self::normalize_code(&p_id);

            if !norm_order.is_empty() && norm_p_order == norm_order {
                matched_id = Some(p_id);
                break;
            }
            if !norm_model.is_empty() && (norm_p_order == norm_model || norm_p_id == norm_model) {
                matched_id = Some(p_id);
                break;
            }
            if norm_p_order.len() >= 6 && (norm_model.contains(&norm_p_order) || norm_p_order.contains(&norm_model)) {
                matched_id = Some(p_id);
                break;
            }
        }

        if let Some(id) = matched_id {
            if let Ok(mut stmt) = conn.prepare("SELECT data_json FROM products WHERE id = ?1 LIMIT 1") {
                if let Ok(json) = stmt.query_row(params![id], |r| r.get::<_, String>(0)) {
                    return serde_json::from_str(&json).ok();
                }
            }
        }

        None
    }

    /// Enriches a project device with full catalog descriptions, KOs, and parameter definitions
    /// WITHOUT overwriting existing configured parameter values or group address links!
    pub fn enrich_device_with_catalog(device: &mut KnxDevice, catalog_prod: &CatalogProduct) {
        if device.order_number.is_none() || device.order_number.as_deref() == Some("") {
            device.order_number = Some(catalog_prod.order_number.clone());
        }
        if device.model.is_empty() {
            device.model = catalog_prod.order_number.clone();
        }
        if device.name.is_empty() || device.name.starts_with("KNX Gerät ") {
            device.name = catalog_prod.name.clone();
        }
        device.manufacturer = catalog_prod.manufacturer.clone();
        if device.application_program.is_none() {
            device.application_program = Some(catalog_prod.application_program.clone());
        }
        if device.mask_version.is_none() {
            device.mask_version = Some(catalog_prod.mask_version.clone());
        }
        if device.bus_current_ma.is_none() {
            device.bus_current_ma = Some(catalog_prod.bus_current_ma);
        }

        // Channels: If device channels are empty, copy default channels
        if device.channels.is_empty() {
            device.channels = catalog_prod
                .default_channels
                .iter()
                .map(|ch| DeviceChannel {
                    id: Uuid::new_v4(),
                    device_id: device.id,
                    channel_code: ch.channel_code.clone(),
                    name: ch.name.clone(),
                    channel_type: ch.channel_type.clone(),
                    room_id: device.room_id,
                    position: None,
                })
                .collect();
        }

        // Enrich Communication Objects while strictly preserving group address links
        for cat_ko in &catalog_prod.communication_objects {
            if let Some(existing_ko) = device.communication_objects.iter_mut().find(|k| k.number == cat_ko.number) {
                if !cat_ko.object_text.is_empty() && existing_ko.object_text.is_empty() {
                    existing_ko.object_text = cat_ko.object_text.clone();
                }
                if !cat_ko.function_text.is_empty() && existing_ko.function_text.is_empty() {
                    existing_ko.function_text = cat_ko.function_text.clone();
                }
                if existing_ko.dpt.is_empty() {
                    existing_ko.dpt = cat_ko.dpt.clone();
                }
                if existing_ko.object_size.is_empty() {
                    existing_ko.object_size = cat_ko.object_size.clone();
                }
                if existing_ko.depends_on.is_none() {
                    existing_ko.depends_on = cat_ko.depends_on.clone();
                }
            } else {
                device.communication_objects.push(cat_ko.clone());
            }
        }
        device.communication_objects.sort_by_key(|c| c.number);

        // Enrich Parameters while strictly preserving user-configured values
        let mut existing_val_map: HashMap<String, String> = HashMap::new();
        for p in &device.parameters {
            existing_val_map.insert(p.id.clone(), p.value.clone());
            existing_val_map.insert(p.name.clone(), p.value.clone());
        }

        let mut enriched_params = catalog_prod.parameters.clone();
        for p in &mut enriched_params {
            if let Some(v) = existing_val_map.get(&p.id).or_else(|| existing_val_map.get(&p.name)) {
                p.value = v.clone();
            }
        }
        // Also keep any custom parameters that might have been in the device but not in catalog
        let cat_param_ids: std::collections::HashSet<String> = enriched_params.iter().map(|p| p.id.clone()).collect();
        for p in &device.parameters {
            if !cat_param_ids.contains(&p.id) {
                enriched_params.push(p.clone());
            }
        }
        device.parameters = enriched_params;
        if !catalog_prod.assign_rules.is_empty() {
            device.assign_rules = catalog_prod.assign_rules.clone();
        }

        if device.visible_ko_numbers.is_empty() {
            device.visible_ko_numbers = crate::model::calculate_active_ko_numbers(device);
        }
    }

    /// Enriches all devices in a project against the catalog
    pub async fn enrich_all_devices(&self, project: &mut Project) -> usize {
        let mut count = 0;
        for dev in &mut project.devices {
            if let Some(matching_prod) = self.find_matching_product(dev).await {
                Self::enrich_device_with_catalog(dev, &matching_prod);
                count += 1;
            }
        }
        count
    }

    /// Returns all catalog products with full details
    pub async fn get_all_products(&self) -> Vec<CatalogProduct> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare("SELECT data_json FROM products ORDER BY manufacturer ASC, name ASC") {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map([], |r| r.get::<_, String>(0)) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(|r| r.ok())
            .filter_map(|json| serde_json::from_str::<CatalogProduct>(&json).ok())
            .collect()
    }

    /// Returns a specific catalog product on demand by ID
    pub async fn get_product(&self, id: &str) -> Option<CatalogProduct> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT data_json FROM products WHERE id = ?1 LIMIT 1").ok()?;
        let json: String = stmt.query_row(params![id], |row| row.get(0)).ok()?;
        serde_json::from_str(&json).ok()
    }

    /// Imports products from .knxprod bytes (e.g. from file upload) directly into SQLite
    pub async fn import_knxprod_bytes(&self, bytes: &[u8]) -> Result<Vec<CatalogProductSummary>, String> {
        // Check if user uploaded a legacy .vd4 archive
        if let Ok(mut zip) = zip::ZipArchive::new(Cursor::new(bytes)) {
            for i in 0..zip.len() {
                if let Ok(f) = zip.by_index(i) {
                    let fn_lower = f.name().to_lowercase();
                    if fn_lower.ends_with(".vd_") || fn_lower.ends_with(".dll") {
                        return Err(
                            "Das Format .vd4 ist ein veraltetes ETS3-Format (2007) mit 32-Bit-Windows-DLLs. Bitte verwenden Sie die moderne .knxprod-Datei des Herstellers oder konvertieren Sie die Datei einmalig über die ETS.".to_string()
                        );
                    }
                }
            }
        }

        let parsed = parse_knxprod(bytes)?;
        if parsed.is_empty() {
            return Err("Keine gültigen KNX-Produkte im Archiv gefunden.".to_string());
        }

        let mut summaries = Vec::new();
        {
            let conn = self.conn.lock().unwrap();
            let _ = conn.execute("BEGIN TRANSACTION", []);
            for prod in &parsed {
                let _ = Self::upsert_product_conn(&conn, prod);
                summaries.push(CatalogProductSummary {
                    id: prod.id.clone(),
                    order_number: prod.order_number.clone(),
                    manufacturer: prod.manufacturer.clone(),
                    name: prod.name.clone(),
                    hardware_name: prod.hardware_name.clone(),
                    application_program: prod.application_program.clone(),
                    mask_version: prod.mask_version.clone(),
                    bus_current_ma: prod.bus_current_ma,
                    channel_count: prod.default_channels.len(),
                    ko_count: prod.communication_objects.len(),
                    param_count: prod.parameters.len(),
                });
            }
            let _ = conn.execute("COMMIT", []);
        }

        info!("Imported and stored {} products in SQLite catalog.db", parsed.len());
        Ok(summaries)
    }

    /// Creates a full KnxDevice instance with all KOs and parameters ready to be added to Project
    pub async fn create_device_from_product(
        &self,
        product_id: &str,
        individual_address: &str,
        custom_name: Option<&str>,
    ) -> Result<KnxDevice, String> {
        let product = self
            .get_product(product_id)
            .await
            .ok_or_else(|| format!("Produkt '{}' nicht im Katalog gefunden.", product_id))?;

        let dev_id = Uuid::new_v4();

        // Instantiate channels with new device_id
        let channels: Vec<DeviceChannel> = product
            .default_channels
            .iter()
            .map(|ch| DeviceChannel {
                id: Uuid::new_v4(),
                device_id: dev_id,
                channel_code: ch.channel_code.clone(),
                name: ch.name.clone(),
                channel_type: ch.channel_type.clone(),
                room_id: None,
                position: None,
            })
            .collect();

        let dev_name = custom_name
            .map(|s| s.to_string())
            .unwrap_or_else(|| product.name.clone());

        let mut dev = KnxDevice {
            id: dev_id,
            individual_address: individual_address.to_string(),
            manufacturer: product.manufacturer.clone(),
            model: product.order_number.clone(),
            name: dev_name,
            room_id: None,
            channels,
            position: None,
            order_number: Some(product.order_number.clone()),
            application_program: Some(product.application_program.clone()),
            mask_version: Some(product.mask_version.clone()),
            bus_current_ma: Some(product.bus_current_ma),
            communication_objects: product.communication_objects.clone(),
            parameters: product.parameters.clone(),
            assign_rules: product.assign_rules.clone(),
            visible_ko_numbers: Vec::new(),
            last_flashed_state: None,
            security: None,
            loaded_image: None,
            checksums: None,
            ..Default::default()
        };
        dev.visible_ko_numbers = crate::model::calculate_active_ko_numbers(&dev);
        Ok(dev)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_knxprod_dpt() {
        assert_eq!(format_knxprod_dpt("DPST-1-8"), "1.008");
        assert_eq!(format_knxprod_dpt("DPST-1-1"), "1.001");
        assert_eq!(format_knxprod_dpt("DPST-5-1"), "5.001");
        assert_eq!(format_knxprod_dpt("DPT-1"), "1.001");
        assert_eq!(format_knxprod_dpt("9.001"), "9.001");
    }

    #[test]
    fn test_parse_real_mdt_knxprod() {
        let path = "database/mdt/MDT_KP_JAL_B1UP_02_Shutter_Actuator_V39.knxprod";
        if let Ok(bytes) = std::fs::read(path) {
            let products = parse_knxprod(&bytes).expect("Failed to parse real MDT knxprod");
            assert!(!products.is_empty());
            let p = &products[0];
            assert_eq!(p.manufacturer, "MDT Technologies");
            assert!(p.order_number.contains("JAL-B1UP.02"));
            assert!(!p.communication_objects.is_empty(), "Must have communication objects");
            assert!(p.communication_objects.len() >= 50, "Should have ~72 KOs");
            assert!(!p.parameters.is_empty(), "Must have parameters");
            assert!(p.parameters.len() >= 100, "Should have ~274 parameters");
        }
    }

    #[test]
    fn test_clean_knx_template() {
        assert_eq!(clean_knx_template("{{0:Jalousie}} &quot;Auf/Ab&quot;"), "Jalousie \"Auf/Ab\"");
        assert_eq!(clean_knx_template("{{ChNo}} Funktion: {{1:Schalten}}"), "Funktion: Schalten");
        assert_eq!(clean_knx_template("{{0}} {{1}} Parameter"), "Parameter");
    }

    #[test]
    fn test_hierarchical_conditions_serialization() {
        let dep = ParameterDependency {
            param_id: "P-1".to_string(),
            when_values: vec!["1".to_string()],
            conditions: vec![
                ParameterCondition { param_id: "P-CH".to_string(), when_values: vec!["1".to_string()] },
                ParameterCondition { param_id: "P-MODE".to_string(), when_values: vec!["2".to_string()] },
            ],
        };
        let json = serde_json::to_string(&dep).unwrap();
        let deserialized: ParameterDependency = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.conditions.len(), 2);
        assert_eq!(deserialized.conditions[0].param_id, "P-CH");
    }

    #[test]
    fn test_two_identical_devices_consistent_parameters() {
        let path = "database/mdt/AKD-02x0CC-02_MDT_KP_V31.knxprod";
        if let Ok(bytes) = std::fs::read(path) {
            let products = parse_knxprod(&bytes).expect("parse knxprod");
            assert!(!products.is_empty());
            let prod1 = &products[0];
            
            // Re-parse to simulate loading second identical device
            let products2 = parse_knxprod(&bytes).expect("parse knxprod second time");
            let prod2 = &products2[0];

            assert_eq!(prod1.parameters.len(), prod2.parameters.len(), "Parameter count must be identical");
            assert_eq!(prod1.communication_objects.len(), prod2.communication_objects.len(), "KO count must be identical");
            assert_eq!(prod1.name, prod2.name);
            assert_eq!(prod1.order_number, prod2.order_number);
        }
    }

    #[test]
    fn test_enrich_device_with_catalog_preserves_values_and_gas() {
        let cat_prod = CatalogProduct {
            id: "MDT_TEST_01".to_string(),
            order_number: "TEST-01".to_string(),
            manufacturer: "MDT Technologies".to_string(),
            name: "MDT Testaktor 4-fach".to_string(),
            hardware_name: "Testaktor HW".to_string(),
            application_program: "App V1.0".to_string(),
            mask_version: "07B0h".to_string(),
            bus_current_ma: 10,
            default_channels: vec![],
            communication_objects: vec![
                CommunicationObject {
                    id: "KO_0".to_string(),
                    number: 0,
                    name: "Switch_A".to_string(),
                    object_text: "Kanal A".to_string(),
                    function_text: "Schalten Ein/Aus".to_string(),
                    dpt: "1.001".to_string(),
                    object_size: "1 Bit".to_string(),
                    flags: ComObjectFlags::default(),
                    group_address_ids: vec![],
                    group_addresses: vec![],
                    depends_on: None,
                },
            ],
            parameters: vec![
                DeviceParameter {
                    id: "P_TIME".to_string(),
                    name: "staircase_time".to_string(),
                    text: "Treppenlicht-Zeit".to_string(),
                    param_type: "number".to_string(),
                    value: "60".to_string(), // Catalog default
                    default_value: "60".to_string(),
                    suffix: Some("s".to_string()),
                    options: vec![],
                    enum_options: vec![],
                    page: Some("Kanal A".to_string()),
                    pages: vec![],
                    section: None,
                    depends_on: None,
                    access: None,
                    offset: None,
                    bit_offset: None,
                    size_in_bit: None,
                    min: Some(1.0),
                    max: Some(3600.0),
                    step: Some(1.0),
                    is_float: Some(false),
                },
            ],
            assign_rules: vec![],
        };

        // Existing project device with custom name, custom configured parameter, and linked GA
        let ga_uuid = Uuid::new_v4();
        let mut device = KnxDevice {
            id: Uuid::new_v4(),
            individual_address: "1.1.10".to_string(),
            manufacturer: "MDT".to_string(),
            model: "TEST-01".to_string(),
            name: "Mein Wohnzimmer Aktor".to_string(),
            room_id: None,
            channels: vec![],
            position: None,
            order_number: Some("TEST-01".to_string()),
            application_program: None,
            mask_version: None,
            bus_current_ma: None,
            communication_objects: vec![
                CommunicationObject {
                    id: "KO_0".to_string(),
                    number: 0,
                    name: "KO_0".to_string(),
                    object_text: String::new(),
                    function_text: "".to_string(),
                    dpt: "1.001".to_string(),
                    object_size: "1 Bit".to_string(),
                    flags: ComObjectFlags::default(),
                    group_address_ids: vec![ga_uuid],
                    group_addresses: vec!["1/1/1".to_string()],
                    depends_on: None,
                },
            ],
            parameters: vec![
                DeviceParameter {
                    id: "P_TIME".to_string(),
                    name: "staircase_time".to_string(),
                    text: "Treppenlicht".to_string(),
                    param_type: "number".to_string(),
                    value: "180".to_string(), // USER CONFIGURED VALUE! Must NOT be overwritten
                    default_value: "60".to_string(),
                    suffix: None,
                    options: vec![],
                    enum_options: vec![],
                    page: None,
                    pages: vec![],
                    section: None,
                    depends_on: None,
                    access: None,
                    offset: None,
                    bit_offset: None,
                    size_in_bit: None,
                    min: Some(1.0),
                    max: Some(3600.0),
                    step: Some(1.0),
                    is_float: Some(false),
                },
            ],
            assign_rules: vec![],
            visible_ko_numbers: vec![],
            last_flashed_state: None,
            security: None,
            loaded_image: None,
            checksums: None,
            ..Default::default()
        };

        CatalogManager::enrich_device_with_catalog(&mut device, &cat_prod);

        // Verify custom name is preserved
        assert_eq!(device.name, "Mein Wohnzimmer Aktor");
        // Verify manufacturer and metadata enriched
        assert_eq!(device.manufacturer, "MDT Technologies");
        assert_eq!(device.application_program.as_deref(), Some("App V1.0"));
        // Verify KO GA links are strictly preserved!
        assert_eq!(device.communication_objects[0].group_addresses, vec!["1/1/1".to_string()]);
        assert_eq!(device.communication_objects[0].group_address_ids, vec![ga_uuid]);
        // Verify KO text is enriched
        assert_eq!(device.communication_objects[0].object_text, "Kanal A");
        assert_eq!(device.communication_objects[0].function_text, "Schalten Ein/Aus");
        // Verify user-configured value "180" is preserved, NOT reset to catalog default "60"!
        assert_eq!(device.parameters[0].value, "180");
        // Verify parameter metadata enriched (page and suffix)
        assert_eq!(device.parameters[0].page.as_deref(), Some("Kanal A"));
        assert_eq!(device.parameters[0].suffix.as_deref(), Some("s"));
    }

    #[tokio::test]
    async fn test_sqlite_catalog_manager_operations() {
        let mgr = CatalogManager::new_in_memory();

        // 1. Verify summaries
        let summaries = mgr.get_all_summaries().await;
        assert!(!summaries.is_empty(), "Built-in catalog must be seeded");
        let first = &summaries[0];
        assert!(!first.order_number.is_empty());
        assert!(!first.name.is_empty());
        assert!(first.ko_count > 0);

        // 2. Verify on-demand full product fetch
        let full_prod = mgr.get_product(&first.id).await.expect("Must find product by ID");
        assert_eq!(full_prod.id, first.id);
        assert_eq!(full_prod.order_number, first.order_number);
        assert_eq!(full_prod.communication_objects.len(), first.ko_count);
        assert_eq!(full_prod.parameters.len(), first.param_count);

        // 3. Verify matching by device model
        let dev = KnxDevice {
            id: Uuid::new_v4(),
            individual_address: "1.1.20".to_string(),
            manufacturer: "".to_string(),
            model: first.order_number.clone(),
            name: "Test".to_string(),
            room_id: None,
            channels: vec![],
            position: None,
            order_number: Some(first.order_number.clone()),
            application_program: None,
            mask_version: None,
            bus_current_ma: None,
            communication_objects: vec![],
            parameters: vec![],
            assign_rules: vec![],
            visible_ko_numbers: vec![],
            last_flashed_state: None,
            security: None,
            loaded_image: None,
            checksums: None,
            ..Default::default()
        };

        let matched = mgr.find_matching_product(&dev).await.expect("Must match product");
        assert_eq!(matched.order_number, first.order_number);

        // 4. Verify VD4 rejection
        let fake_vd4_bytes = {
            let mut buf = Vec::new();
            {
                let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
                let options = zip::write::SimpleFileOptions::default();
                zip.start_file("Programme/Ets3/Database/ets.vd_", options).unwrap();
                use std::io::Write;
                zip.write_all(b"fake encrypted").unwrap();
                zip.finish().unwrap();
            }
            buf
        };

        let err = mgr.import_knxprod_bytes(&fake_vd4_bytes).await.unwrap_err();
        assert!(err.contains("veraltetes ETS3-Format"), "Must reject .vd4 with informative message");
    }

    #[test]
    fn test_dynamic_parameter_page_and_section_parsing() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20">
  <ManufacturerData>
    <Manufacturer RefId="M-0002">
      <ApplicationPrograms>
        <ApplicationProgram Id="M-0002_A-1234-10-0000" ApplicationNumber="1234" ApplicationVersion="10" ProgramVersion="1.0">
          <Static>
            <Parameters>
              <Parameter Id="M-0002_A-1234-10-0000_P-1" Name="GlobalMode" ParameterType="PT-1" Value="0" />
              <Parameter Id="M-0002_A-1234-10-0000_P-2" Name="ChannelOpMode" ParameterType="PT-1" Value="1" />
              <Parameter Id="M-0002_A-1234-10-0000_P-3" Name="TimerDuration" ParameterType="PT-1" Value="60" />
            </Parameters>
            <ParameterRefRefs>
              <ParameterRefRef Id="M-0002_A-1234-10-0000_P-1_R-1" RefId="M-0002_A-1234-10-0000_P-1" />
              <ParameterRefRef Id="M-0002_A-1234-10-0000_P-2_R-2" RefId="M-0002_A-1234-10-0000_P-2" />
              <ParameterRefRef Id="M-0002_A-1234-10-0000_P-3_R-3" RefId="M-0002_A-1234-10-0000_P-3" />
            </ParameterRefRefs>
            <ComObjectTable>
              <ComObject Id="M-0002_A-1234-10-0000_O-1" Number="1" Name="Output_A" Text="Schaltaktor" FunctionText="Schalten" DatapointType="DPST-1-1" ObjectSize="1 Bit" />
            </ComObjectTable>
          </Static>
          <Dynamic>
            <ParameterRefRef RefId="M-0002_A-1234-10-0000_P-1_R-1" />
            <Channel Id="M-0002_A-1234-10-0000_CH-1" Name="Output A" Text="Ausgang A">
              <ParameterBlock Id="M-0002_A-1234-10-0000_PB-1" Name="Operation" Text="Betriebsart">
                <ParameterSeparator Id="M-0002_A-1234-10-0000_PS-1" Text="Grundkonfiguration" />
                <ParameterRefRef RefId="M-0002_A-1234-10-0000_P-2_R-2" />
                <ParameterSeparator Id="M-0002_A-1234-10-0000_PS-2" Text="Zeiteinstellungen" />
                <ParameterRefRef RefId="M-0002_A-1234-10-0000_P-3_R-3" />
              </ParameterBlock>
            </Channel>
          </Dynamic>
          <Languages>
            <Language Identifier="en-US">
              <TranslationElement RefId="M-0002_A-1234-10-0000_CH-1">
                <Translation AttributeName="Text" Text="Output A" />
              </TranslationElement>
            </Language>
            <Language Identifier="de-DE">
              <TranslationElement RefId="M-0002_A-1234-10-0000_CH-1">
                <Translation AttributeName="Text" Text="Ausgang A (DE)" />
              </TranslationElement>
              <TranslationElement RefId="M-0002_A-1234-10-0000_PB-1">
                <Translation AttributeName="Text" Text="Betriebsart (DE)" />
              </TranslationElement>
            </Language>
          </Languages>
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>"#;

        let (cos, params, _app_name, _mask, _param_names, _assign_rules) = parse_app_program_xml(xml);

        assert_eq!(params.len(), 3);
        // P-1 has no channel/block -> page must be None, NOT "Allgemein"!
        let p1 = params.iter().find(|p| p.id.ends_with("_P-1")).expect("P-1 must exist");
        assert_eq!(p1.page, None);
        assert!(p1.pages.is_empty());

        // P-2 has channel "Ausgang A (DE)" and block "Betriebsart (DE)"
        let p2 = params.iter().find(|p| p.id.ends_with("_P-2")).expect("P-2 must exist");
        assert_eq!(p2.page.as_deref(), Some("Ausgang A (DE) > Betriebsart (DE)"));
        assert_eq!(p2.section.as_deref(), Some("Grundkonfiguration"));

        // P-3 has section "Zeiteinstellungen"
        let p3 = params.iter().find(|p| p.id.ends_with("_P-3")).expect("P-3 must exist");
        assert_eq!(p3.page.as_deref(), Some("Ausgang A (DE) > Betriebsart (DE)"));
        assert_eq!(p3.section.as_deref(), Some("Zeiteinstellungen"));

        // Verify CO
        assert_eq!(cos.len(), 1);
        assert_eq!(cos[0].object_text, "Schaltaktor");
        assert_eq!(cos[0].function_text, "Schalten");
        assert_eq!(cos[0].dpt, "1.001");
    }

    #[test]
    fn test_dynamic_com_object_ref_ref() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/23">
  <ManufacturerData>
    <Manufacturer RefId="M-0002">
      <ApplicationPrograms>
        <ApplicationProgram Id="M-0002_A-TEST" Name="Dynamic KO Test" ApplicationNumber="1" ApplicationVersion="1" ProgramVersion="1.0" MaskVersion="MV-07B0">
          <Static>
            <Parameters>
              <Parameter Id="M-0002_A-TEST_P-MODE" Name="ChannelMode" ParameterType="PT-1" Value="1" />
            </Parameters>
            <ParameterTypes>
              <ParameterType Id="PT-1">
                <TypeRestriction Base="Value" SizeInBit="8" />
              </ParameterType>
            </ParameterTypes>
            <ParameterRefs>
              <ParameterRef Id="M-0002_A-TEST_P-MODE_R" RefId="M-0002_A-TEST_P-MODE" />
            </ParameterRefs>
            <ComObjectTable>
              <ComObject Id="M-0002_A-TEST_O-1" Number="0" Name="Switch_KO" Text="Kanal A" FunctionText="Schalten" ObjectSize="1 Bit" DatapointType="DPST-1-1" />
              <ComObject Id="M-0002_A-TEST_O-2" Number="1" Name="Blind_KO" Text="Kanal A" FunctionText="Auf/Ab" ObjectSize="1 Bit" DatapointType="DPST-1-8" />
            </ComObjectTable>
            <ComObjectRefs>
              <ComObjectRef Id="M-0002_A-TEST_O-1_R" RefId="M-0002_A-TEST_O-1" Text="Kanal A Schalten" />
              <ComObjectRef Id="M-0002_A-TEST_O-2_R" RefId="M-0002_A-TEST_O-2" Text="Kanal A Jalousie" />
            </ComObjectRefs>
          </Static>
          <Dynamic>
            <Channel Id="M-0002_A-TEST_CH-1" Name="Kanal A">
              <choose ParamRefId="M-0002_A-TEST_P-MODE_R">
                <when test="1">
                  <ComObjectRefRef RefId="M-0002_A-TEST_O-1_R" />
                </when>
                <when test="2">
                  <ComObjectRefRef RefId="M-0002_A-TEST_O-2_R" />
                </when>
              </choose>
            </Channel>
          </Dynamic>
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>"#;

        let (cos, params, _, _, _, _) = parse_app_program_xml(xml);
        assert_eq!(cos.len(), 2);

        // Verify O-1 has dependency on P-MODE == "1"
        let ko1 = cos.iter().find(|c| c.number == 0).expect("KO 0 must exist");
        assert_eq!(ko1.object_text, "Kanal A Schalten");
        assert!(ko1.depends_on.is_some(), "KO 0 must have depends_on");
        let dep1 = ko1.depends_on.as_ref().unwrap();
        assert_eq!(dep1.when_values, vec!["1"]);

        // Verify O-2 has dependency on P-MODE == "2"
        let ko2 = cos.iter().find(|c| c.number == 1).expect("KO 1 must exist");
        assert_eq!(ko2.object_text, "Kanal A Jalousie");
        assert!(ko2.depends_on.is_some(), "KO 1 must have depends_on");
        let dep2 = ko2.depends_on.as_ref().unwrap();
        assert_eq!(dep2.when_values, vec!["2"]);

        // Test calculate_active_ko_numbers
        let mut dev = KnxDevice {
            id: Uuid::new_v4(),
            individual_address: "1.1.1".to_string(),
            communication_objects: cos.clone(),
            parameters: params.clone(),
            ..Default::default()
        };

        // When mode is "1": only KO 0 is active
        dev.parameters[0].value = "1".to_string();
        let active = crate::model::calculate_active_ko_numbers(&dev);
        assert_eq!(active, vec![0]);

        // When mode is "2": only KO 1 is active
        dev.parameters[0].value = "2".to_string();
        let active2 = crate::model::calculate_active_ko_numbers(&dev);
        assert_eq!(active2, vec![1]);

        // When mode is "3": neither is active
        dev.parameters[0].value = "3".to_string();
        let active3 = crate::model::calculate_active_ko_numbers(&dev);
        assert!(active3.is_empty());
    }
}

