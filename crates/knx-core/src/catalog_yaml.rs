use crate::knxprod::{format_knxprod_dpt, infer_channels_from_product};
use crate::model::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlManufacturer {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub legacy_knx_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlHardware {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub bus_current_ma: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlDevice {
    pub order_number: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub hardware: Option<KonfixYamlHardware>,
    #[serde(default)]
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlApplication {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub mask_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlComObjectFlags {
    #[serde(default)]
    pub communication: Option<bool>,
    #[serde(default)]
    pub read: Option<bool>,
    #[serde(default)]
    pub write: Option<bool>,
    #[serde(default)]
    pub transmit: Option<bool>,
    #[serde(default)]
    pub update: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlCondition {
    pub param_id: String,
    #[serde(default)]
    pub when_values: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlComObject {
    #[serde(default)]
    pub id: Option<String>,
    pub number: u32,
    pub name: String,
    #[serde(default)]
    pub function: Option<String>,
    #[serde(default)]
    pub dpt: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub flags: Option<KonfixYamlComObjectFlags>,
    #[serde(default)]
    pub conditions: Option<Vec<KonfixYamlCondition>>,
    #[serde(default)]
    pub depends_on: Option<KonfixYamlCondition>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlParamOption {
    pub value: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlParameter {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(rename = "type", default)]
    pub param_type: Option<String>,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub options: Option<Vec<KonfixYamlParamOption>>,
    #[serde(default)]
    pub page: Option<String>,
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub suffix: Option<String>,
    #[serde(default)]
    pub conditions: Option<Vec<KonfixYamlCondition>>,
    #[serde(default)]
    pub depends_on: Option<KonfixYamlCondition>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlAssignRule {
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub conditions: Option<Vec<KonfixYamlCondition>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KonfixYamlRoot {
    #[serde(default)]
    pub konfix_version: Option<String>,
    pub manufacturer: KonfixYamlManufacturer,
    pub device: KonfixYamlDevice,
    #[serde(default)]
    pub application: Option<KonfixYamlApplication>,
    #[serde(default)]
    pub communication_objects: Option<Vec<KonfixYamlComObject>>,
    #[serde(default)]
    pub parameters: Option<Vec<KonfixYamlParameter>>,
    #[serde(default)]
    pub assign_rules: Option<Vec<KonfixYamlAssignRule>>,
}

fn convert_conditions(
    conds: Option<&[KonfixYamlCondition]>,
    single: Option<&KonfixYamlCondition>,
) -> Option<ParameterDependency> {
    if let Some(c_list) = conds {
        if let Some(first) = c_list.first() {
            let mut dep = ParameterDependency {
                param_id: first.param_id.clone(),
                when_values: first.when_values.clone(),
                conditions: Vec::new(),
            };
            for c in c_list {
                dep.conditions.push(ParameterCondition {
                    param_id: c.param_id.clone(),
                    when_values: c.when_values.clone(),
                });
            }
            return Some(dep);
        }
    }
    if let Some(s) = single {
        return Some(ParameterDependency {
            param_id: s.param_id.clone(),
            when_values: s.when_values.clone(),
            conditions: vec![ParameterCondition {
                param_id: s.param_id.clone(),
                when_values: s.when_values.clone(),
            }],
        });
    }
    None
}

/// Parses a KoNfiX Device YAML string (conforming to https://konfix.sduni.de/schemas/konfix-device-v1.json)
/// and converts it into a `CatalogProduct` ready for SQLite storage and device instantiation.
pub fn parse_konfix_device_yaml(yaml_str: &str) -> Result<CatalogProduct, String> {
    let root: KonfixYamlRoot = serde_yaml::from_str(yaml_str)
        .map_err(|e| format!("Fehler beim Parsen der KoNfiX-Geräte-YAML: {}", e))?;

    let mfg_code = root.manufacturer.code.trim();
    let order_number = root.device.order_number.trim();
    if order_number.is_empty() {
        return Err("Gerätedefinition enthält keine gültige 'order_number'".to_string());
    }

    let prod_id = format!("{}_{}", mfg_code.to_uppercase(), order_number.replace([' ', '/', '.'], "_"));
    let mfg_name = if root.manufacturer.name.trim().is_empty() {
        mfg_code.to_uppercase()
    } else {
        root.manufacturer.name.trim().to_string()
    };

    let dev_name = if root.device.name.trim().is_empty() {
        order_number.to_string()
    } else {
        root.device.name.trim().to_string()
    };

    let hw_name = root
        .device
        .hardware
        .as_ref()
        .and_then(|h| h.name.clone())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| dev_name.clone());

    let bus_current_ma = root
        .device
        .hardware
        .as_ref()
        .and_then(|h| h.bus_current_ma)
        .map(|v| v.max(0.0) as u16)
        .unwrap_or(10);

    let app_name = root
        .application
        .as_ref()
        .and_then(|a| a.name.clone())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| format!("Applikation {}", order_number));

    let mask_version = root
        .application
        .as_ref()
        .and_then(|a| a.mask_version.clone())
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| "07B0h (System B)".to_string());

    let mut cos = Vec::new();
    if let Some(raw_cos) = root.communication_objects {
        for c in raw_cos {
            let ko_id = c.id.unwrap_or_else(|| format!("{}_o-{}", mfg_code, c.number));
            let dpt_clean = format_knxprod_dpt(c.dpt.as_deref().unwrap_or(""));
            let size = c.size.unwrap_or_else(|| "1 Bit".to_string());
            let function_text = c.function.unwrap_or_default();
            
            // Extract channel indicator from object name (e.g. "Kanal A Schalten" -> "Kanal A")
            let object_text = if c.name.starts_with("Kanal ") {
                let parts: Vec<&str> = c.name.split_whitespace().collect();
                if parts.len() >= 2 {
                    format!("{} {}", parts[0], parts[1])
                } else {
                    c.name.clone()
                }
            } else {
                c.name.clone()
            };

            let flags = c.flags.as_ref();
            let com_flags = ComObjectFlags {
                communication: flags.and_then(|f| f.communication).unwrap_or(true),
                read: flags.and_then(|f| f.read).unwrap_or(false),
                write: flags.and_then(|f| f.write).unwrap_or(true),
                transmit: flags.and_then(|f| f.transmit).unwrap_or(false),
                update: flags.and_then(|f| f.update).unwrap_or(false),
            };

            let depends_on = convert_conditions(c.conditions.as_deref(), c.depends_on.as_ref());

            cos.push(CommunicationObject {
                id: ko_id,
                number: c.number,
                name: c.name,
                object_text,
                object_text_en: None,
                function_text,
                function_text_en: None,
                dpt: dpt_clean,
                object_size: size,
                flags: com_flags,
                group_address_ids: Vec::new(),
                group_addresses: Vec::new(),
                depends_on,
            });
        }
    }
    cos.sort_by_key(|c| c.number);

    let mut params = Vec::new();
    if let Some(raw_params) = root.parameters {
        for p in raw_params {
            let p_type = p.param_type.unwrap_or_else(|| "text".to_string());
            let default_val = match p.default {
                Some(serde_json::Value::String(s)) => s,
                Some(serde_json::Value::Number(n)) => n.to_string(),
                Some(serde_json::Value::Bool(b)) => b.to_string(),
                Some(serde_json::Value::Null) | None => String::new(),
                Some(other) => other.to_string(),
            };

            let mut options_texts = Vec::new();
            let mut enum_options = Vec::new();
            if let Some(opts) = p.options {
                for opt in opts {
                    options_texts.push(opt.text.clone());
                    enum_options.push(ParameterOption {
                        value: opt.value,
                        text: opt.text,
                        text_en: None,
                    });
                }
            }

            let depends_on = convert_conditions(p.conditions.as_deref(), p.depends_on.as_ref());

            params.push(DeviceParameter {
                id: p.id,
                name: p.name.clone(),
                text: p.text.unwrap_or(p.name),
                text_en: None,
                param_type: p_type,
                value: default_val.clone(),
                default_value: default_val,
                suffix: p.suffix,
                options: options_texts,
                enum_options,
                page: p.page,
                pages: Vec::new(),
                section: p.section,
                depends_on,
                access: None,
                offset: None,
                bit_offset: None,
                size_in_bit: None,
                min: None,
                max: None,
                step: None,
                is_float: None,
            });
        }
    }

    let mut assign_rules = Vec::new();
    if let Some(raw_rules) = root.assign_rules {
        for r in raw_rules {
            if let Some(target) = r.target {
                let conditions = r.conditions.unwrap_or_default().into_iter().map(|c| {
                    ParameterCondition {
                        param_id: c.param_id,
                        when_values: c.when_values,
                    }
                }).collect();

                assign_rules.push(ParameterAssignRule {
                    target_param_id: target,
                    source_param_id: None,
                    value: r.value,
                    conditions,
                });
            }
        }
    }

    let default_channels = infer_channels_from_product(order_number, &dev_name, &cos);

    Ok(CatalogProduct {
        id: prod_id,
        order_number: order_number.to_string(),
        manufacturer: mfg_name,
        name: dev_name,
        hardware_name: hw_name,
        application_program: app_name,
        mask_version,
        bus_current_ma,
        default_channels,
        communication_objects: cos,
        parameters: params,
        assign_rules,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sample_device_yaml() {
        let yaml_sample = r#"
$schema: https://konfix.sduni.de/schemas/konfix-device-v1.json
konfix_version: '1.0'
manufacturer:
  code: mdt
  name: MDT technologies
  legacy_knx_id: M-0083
device:
  order_number: AKS-0816.04
  name: Schaltaktor 8-fach 16A
  description: Schaltaktor 8-fach 16A für KNX-Bussysteme
  hardware:
    name: Schaltaktor Standard
    version: '1'
    bus_current_ma: 12.0
application:
  id: mdt_a_aks-0816-04
  name: Schalten 8f 16A
  version: '4.2'
  mask_version: MV-07B0
communication_objects:
- id: mdt_o-1
  number: 1
  name: Kanal A Schalten
  function: Schalten Ein/Aus
  dpt: 'DPST-1-1'
  size: '1 Bit'
  flags:
    communication: true
    read: false
    write: true
    transmit: false
    update: false
- id: mdt_o-2
  number: 2
  name: Kanal A Status
  function: Status Rückmeldung
  dpt: '1.001'
  size: '1 Bit'
  flags:
    communication: true
    read: true
    write: false
    transmit: true
    update: false
parameters:
- id: mdt_p-1
  name: Relaisfunktion
  text: Relaisfunktion
  default: Schließer
  type: enum
  options:
  - value: "0"
    text: "Schließer"
  - value: "1"
    text: "Öffner"
  page: "Kanal A"
  section: "Grundeinstellungen"
assign_rules:
- target: mdt_p-1
  value: "0"
"#;

        let product = parse_konfix_device_yaml(yaml_sample).expect("YAML parsing failed");
        assert_eq!(product.order_number, "AKS-0816.04");
        assert_eq!(product.manufacturer, "MDT technologies");
        assert_eq!(product.name, "Schaltaktor 8-fach 16A");
        assert_eq!(product.bus_current_ma, 12);
        assert_eq!(product.communication_objects.len(), 2);
        assert_eq!(product.communication_objects[0].dpt, "1.001");
        assert_eq!(product.communication_objects[0].function_text, "Schalten Ein/Aus");
        assert_eq!(product.communication_objects[1].dpt, "1.001");
        assert_eq!(product.communication_objects[1].flags.read, true);
        assert_eq!(product.parameters.len(), 1);
        assert_eq!(product.parameters[0].enum_options.len(), 2);
        assert_eq!(product.assign_rules.len(), 1);
    }

    #[tokio::test]
    async fn test_sqlite_catalog_manager_import_yaml() {
        let mgr = crate::knxprod::CatalogManager::new_in_memory();
        let yaml_sample = r#"
$schema: https://konfix.sduni.de/schemas/konfix-device-v1.json
konfix_version: '1.0'
manufacturer:
  code: gira
  name: Gira Giersiepen
device:
  order_number: 216800
  name: Tastsensor 3 Komfort 1-fach
application:
  name: Tasten 1f
  mask_version: MV-07B0
communication_objects:
- number: 0
  name: Wippe 1 Schalten
  function: Schalten
  dpt: '1.001'
parameters:
- id: p-1
  name: Funktion
  text: Tastenfunktion
"#;

        let summary = mgr
            .import_yaml_bytes(yaml_sample.as_bytes())
            .await
            .expect("Import yaml to SQLite failed");

        assert_eq!(summary.order_number, "216800");
        assert_eq!(summary.manufacturer, "Gira Giersiepen");
        assert_eq!(summary.ko_count, 1);
        assert_eq!(summary.param_count, 1);

        // Verify it can be retrieved from SQLite
        let prod = mgr.get_product(&summary.id).await.expect("Product not found in SQLite");
        assert_eq!(prod.order_number, "216800");
        assert_eq!(prod.communication_objects.len(), 1);

        // Verify device can be instantiated from it
        let dev = mgr
            .create_device_from_product(&summary.id, "1.1.50", Some("Mein Tastsensor"))
            .await
            .expect("Create device failed");

        assert_eq!(dev.name, "Mein Tastsensor");
        assert_eq!(dev.individual_address, "1.1.50");
        assert_eq!(dev.communication_objects.len(), 1);
    }

    #[test]
    fn test_parse_real_yaml_from_catalog_dir() {
        let path = std::path::Path::new("../KoNfiX-Catalog/catalog_files/195664cdf886_AKS-0816.04.yaml");
        if path.exists() {
            let content = std::fs::read_to_string(path).expect("Could not read file");
            let prod = parse_konfix_device_yaml(&content).expect("Failed to parse real yaml");
            assert_eq!(prod.order_number, "AKS-0816.04");
            assert!(!prod.communication_objects.is_empty());
        }
    }
}
