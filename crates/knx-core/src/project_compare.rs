use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::model::{GroupAddress, KnxDevice, Project};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceDiff {
    pub individual_address: String,
    pub name_base: Option<String>,
    pub name_compare: Option<String>,
    pub model_base: Option<String>,
    pub model_compare: Option<String>,
    pub status: DiffStatus, // Added, Deleted, Modified, Unchanged
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GaDiff {
    pub address: String,
    pub name_base: Option<String>,
    pub name_compare: Option<String>,
    pub dpt_base: Option<String>,
    pub dpt_compare: Option<String>,
    pub status: DiffStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParameterDiff {
    pub device_address: String,
    pub device_name: String,
    pub param_id: String,
    pub param_name: String,
    pub value_base: Option<String>,
    pub value_compare: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KoLinkDiff {
    pub device_address: String,
    pub device_name: String,
    pub ko_number: u32,
    pub ko_name: String,
    pub gas_base: Vec<String>,
    pub gas_compare: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffStatus {
    Added,
    Deleted,
    Modified,
    Unchanged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDiff {
    pub base_project_name: String,
    pub compare_project_name: String,
    pub total_differences: usize,
    pub devices: Vec<DeviceDiff>,
    pub group_addresses: Vec<GaDiff>,
    pub parameters: Vec<ParameterDiff>,
    pub ko_links: Vec<KoLinkDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParameterMergeItem {
    pub device_address: String,
    pub param_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KoLinkMergeItem {
    pub device_address: String,
    pub ko_number: u32,
    pub gas: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SelectiveMergeRequest {
    pub compare_project: Option<Project>,
    pub compare_project_filename: Option<String>,
    pub merge_gas: Vec<String>, // list of GA addresses to take from compare
    pub merge_devices: Vec<String>, // list of device individual_addresses to take
    pub merge_parameters: Vec<ParameterMergeItem>,
    pub merge_ko_links: Vec<KoLinkMergeItem>,
    pub merge_all: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeSummary {
    pub gas_merged: usize,
    pub devices_merged: usize,
    pub parameters_merged: usize,
    pub ko_links_merged: usize,
    pub message: String,
}

pub struct ProjectComparer;

impl ProjectComparer {
    pub fn compare(base: &Project, compare: &Project) -> ProjectDiff {
        let mut devices_diff = Vec::new();
        let mut gas_diff = Vec::new();
        let mut parameters_diff = Vec::new();
        let mut ko_links_diff = Vec::new();

        // 1. Devices comparison (keyed by individual_address)
        let base_dev_map: HashMap<&str, &KnxDevice> = base
            .devices
            .iter()
            .map(|d| (d.individual_address.as_str(), d))
            .collect();

        let compare_dev_map: HashMap<&str, &KnxDevice> = compare
            .devices
            .iter()
            .map(|d| (d.individual_address.as_str(), d))
            .collect();

        let mut all_dev_addrs: HashSet<&str> = HashSet::new();
        all_dev_addrs.extend(base_dev_map.keys());
        all_dev_addrs.extend(compare_dev_map.keys());

        let mut sorted_dev_addrs: Vec<&str> = all_dev_addrs.into_iter().collect();
        sorted_dev_addrs.sort();

        for addr in sorted_dev_addrs {
            match (base_dev_map.get(addr), compare_dev_map.get(addr)) {
                (Some(b_dev), None) => {
                    devices_diff.push(DeviceDiff {
                        individual_address: addr.to_string(),
                        name_base: Some(b_dev.name.clone()),
                        name_compare: None,
                        model_base: Some(b_dev.model.clone()),
                        model_compare: None,
                        status: DiffStatus::Deleted,
                    });
                }
                (None, Some(c_dev)) => {
                    devices_diff.push(DeviceDiff {
                        individual_address: addr.to_string(),
                        name_base: None,
                        name_compare: Some(c_dev.name.clone()),
                        model_base: None,
                        model_compare: Some(c_dev.model.clone()),
                        status: DiffStatus::Added,
                    });
                }
                (Some(b_dev), Some(c_dev)) => {
                    let is_modified = b_dev.name != c_dev.name || b_dev.model != c_dev.model;
                    if is_modified {
                        devices_diff.push(DeviceDiff {
                            individual_address: addr.to_string(),
                            name_base: Some(b_dev.name.clone()),
                            name_compare: Some(c_dev.name.clone()),
                            model_base: Some(b_dev.model.clone()),
                            model_compare: Some(c_dev.model.clone()),
                            status: DiffStatus::Modified,
                        });
                    }

                    // Compare Parameters
                    let mut b_params: HashMap<&str, &crate::model::DeviceParameter> = HashMap::new();
                    for p in &b_dev.parameters {
                        b_params.insert(&p.id, p);
                    }
                    let mut c_params: HashMap<&str, &crate::model::DeviceParameter> = HashMap::new();
                    for p in &c_dev.parameters {
                        c_params.insert(&p.id, p);
                    }

                    let mut all_param_keys: HashSet<&str> = HashSet::new();
                    all_param_keys.extend(b_params.keys());
                    all_param_keys.extend(c_params.keys());

                    for key in all_param_keys {
                        let b_param = b_params.get(key);
                        let c_param = c_params.get(key);
                        let b_val = b_param.map(|p| p.value.clone());
                        let c_val = c_param.map(|p| p.value.clone());
                        if b_val != c_val {
                            let param_name = c_param
                                .map(|p| if p.text.is_empty() { p.name.clone() } else { p.text.clone() })
                                .or_else(|| b_param.map(|p| if p.text.is_empty() { p.name.clone() } else { p.text.clone() }))
                                .unwrap_or_else(|| key.to_string());

                            parameters_diff.push(ParameterDiff {
                                device_address: addr.to_string(),
                                device_name: b_dev.name.clone(),
                                param_id: key.to_string(),
                                param_name,
                                value_base: b_val,
                                value_compare: c_val,
                            });
                        }
                    }

                    // Compare KO links
                    let mut b_kos: HashMap<u32, Vec<String>> = HashMap::new();
                    for ko in &b_dev.communication_objects {
                        b_kos.insert(ko.number, ko.group_addresses.clone());
                    }

                    let mut c_kos: HashMap<u32, Vec<String>> = HashMap::new();
                    for ko in &c_dev.communication_objects {
                        c_kos.insert(ko.number, ko.group_addresses.clone());
                    }

                    let mut all_ko_nums: HashSet<u32> = HashSet::new();
                    all_ko_nums.extend(b_kos.keys());
                    all_ko_nums.extend(c_kos.keys());

                    for num in all_ko_nums {
                        let b_gas = b_kos.get(&num).cloned().unwrap_or_default();
                        let c_gas = c_kos.get(&num).cloned().unwrap_or_default();
                        let mut b_sorted = b_gas.clone();
                        b_sorted.sort();
                        let mut c_sorted = c_gas.clone();
                        c_sorted.sort();

                        if b_sorted != c_sorted {
                            let ko_name = c_dev
                                .communication_objects
                                .iter()
                                .find(|k| k.number == num)
                                .map(|k| format!("{}: {}", k.object_text, k.function_text))
                                .or_else(|| {
                                    b_dev
                                        .communication_objects
                                        .iter()
                                        .find(|k| k.number == num)
                                        .map(|k| format!("{}: {}", k.object_text, k.function_text))
                                })
                                .unwrap_or_else(|| format!("KO {}", num));

                            ko_links_diff.push(KoLinkDiff {
                                device_address: addr.to_string(),
                                device_name: b_dev.name.clone(),
                                ko_number: num,
                                ko_name,
                                gas_base: b_gas,
                                gas_compare: c_gas,
                            });
                        }
                    }
                }
                (None, None) => {}
            }
        }

        // 2. Group Addresses comparison (keyed by address)
        let base_ga_map: HashMap<&str, &GroupAddress> = base
            .group_addresses
            .iter()
            .map(|g| (g.address.as_str(), g))
            .collect();

        let compare_ga_map: HashMap<&str, &GroupAddress> = compare
            .group_addresses
            .iter()
            .map(|g| (g.address.as_str(), g))
            .collect();

        let mut all_ga_addrs: HashSet<&str> = HashSet::new();
        all_ga_addrs.extend(base_ga_map.keys());
        all_ga_addrs.extend(compare_ga_map.keys());

        let mut sorted_ga_addrs: Vec<&str> = all_ga_addrs.into_iter().collect();
        sorted_ga_addrs.sort();

        for addr in sorted_ga_addrs {
            match (base_ga_map.get(addr), compare_ga_map.get(addr)) {
                (Some(b_ga), None) => {
                    gas_diff.push(GaDiff {
                        address: addr.to_string(),
                        name_base: Some(b_ga.name.clone()),
                        name_compare: None,
                        dpt_base: Some(b_ga.dpt.clone()),
                        dpt_compare: None,
                        status: DiffStatus::Deleted,
                    });
                }
                (None, Some(c_ga)) => {
                    gas_diff.push(GaDiff {
                        address: addr.to_string(),
                        name_base: None,
                        name_compare: Some(c_ga.name.clone()),
                        dpt_base: None,
                        dpt_compare: Some(c_ga.dpt.clone()),
                        status: DiffStatus::Added,
                    });
                }
                (Some(b_ga), Some(c_ga)) => {
                    let is_modified = b_ga.name != c_ga.name || b_ga.dpt != c_ga.dpt;
                    if is_modified {
                        gas_diff.push(GaDiff {
                            address: addr.to_string(),
                            name_base: Some(b_ga.name.clone()),
                            name_compare: Some(c_ga.name.clone()),
                            dpt_base: Some(b_ga.dpt.clone()),
                            dpt_compare: Some(c_ga.dpt.clone()),
                            status: DiffStatus::Modified,
                        });
                    }
                }
                (None, None) => {}
            }
        }

        let total_differences =
            devices_diff.len() + gas_diff.len() + parameters_diff.len() + ko_links_diff.len();

        ProjectDiff {
            base_project_name: base.name.clone(),
            compare_project_name: compare.name.clone(),
            total_differences,
            devices: devices_diff,
            group_addresses: gas_diff,
            parameters: parameters_diff,
            ko_links: ko_links_diff,
        }
    }

    /// Selective merge from `compare` into `base`
    pub fn apply_merge(
        base: &mut Project,
        compare: &Project,
        req: &SelectiveMergeRequest,
    ) -> MergeSummary {
        let mut gas_merged = 0;
        let mut devices_merged = 0;
        let mut parameters_merged = 0;
        let mut ko_links_merged = 0;

        let merge_all = req.merge_all;

        // 1. Merge Group Addresses
        for c_ga in &compare.group_addresses {
            if merge_all || req.merge_gas.contains(&c_ga.address) {
                if let Some(existing) = base
                    .group_addresses
                    .iter_mut()
                    .find(|g| g.address == c_ga.address)
                {
                    existing.name = c_ga.name.clone();
                    existing.dpt = c_ga.dpt.clone();
                    existing.description = c_ga.description.clone();
                    gas_merged += 1;
                } else {
                    let mut new_ga = (*c_ga).clone();
                    new_ga.id = Uuid::new_v4();
                    base.group_addresses.push(new_ga);
                    gas_merged += 1;
                }
            }
        }

        // 2. Merge Devices
        for c_dev in &compare.devices {
            if merge_all || req.merge_devices.contains(&c_dev.individual_address) {
                if let Some(existing) = base
                    .devices
                    .iter_mut()
                    .find(|d| d.individual_address == c_dev.individual_address)
                {
                    existing.name = c_dev.name.clone();
                    existing.model = c_dev.model.clone();
                    existing.manufacturer = c_dev.manufacturer.clone();
                    devices_merged += 1;
                } else {
                    let mut new_dev = (*c_dev).clone();
                    new_dev.id = Uuid::new_v4();
                    base.devices.push(new_dev);
                    devices_merged += 1;
                }
            }
        }

        // 3. Merge Parameters
        for p_item in &req.merge_parameters {
            if let Some(dev) = base
                .devices
                .iter_mut()
                .find(|d| d.individual_address == p_item.device_address)
            {
                if let Some(param) = dev.parameters.iter_mut().find(|p| p.id == p_item.param_id) {
                    param.value = p_item.value.clone();
                    parameters_merged += 1;
                }
            }
        }

        // 4. Merge KO links
        for ko_item in &req.merge_ko_links {
            if let Some(dev) = base
                .devices
                .iter_mut()
                .find(|d| d.individual_address == ko_item.device_address)
            {
                if let Some(ko) = dev
                    .communication_objects
                    .iter_mut()
                    .find(|k| k.number == ko_item.ko_number)
                {
                    ko.group_addresses = ko_item.gas.clone();
                    ko_links_merged += 1;
                }
            }
        }

        MergeSummary {
            gas_merged,
            devices_merged,
            parameters_merged,
            ko_links_merged,
            message: format!(
                "Merge erfolgreich durchgeführt: {} GAs, {} Geräte, {} Parameter, {} KO-Links aktualisiert.",
                gas_merged, devices_merged, parameters_merged, ko_links_merged
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_compare_differences_and_selective_merge() {
        let mut base = Project::default();
        base.name = "Projekt A".to_string();

        let mut compare = Project::default();
        compare.name = "Projekt B".to_string();

        // Base has GA 1/0/0
        base.group_addresses.push(GroupAddress {
            id: Uuid::new_v4(),
            address: "1/0/0".to_string(),
            name: "Licht Wohnen".to_string(),
            dpt: "1.001".to_string(),
            description: "".to_string(),
            is_custom: true,
            ..Default::default()
        });

        // Compare has GA 1/0/0 modified, and GA 1/0/1 added
        compare.group_addresses.push(GroupAddress {
            id: Uuid::new_v4(),
            address: "1/0/0".to_string(),
            name: "Licht Wohnzimmer Decke".to_string(),
            dpt: "1.001".to_string(),
            description: "".to_string(),
            is_custom: true,
            ..Default::default()
        });
        compare.group_addresses.push(GroupAddress {
            id: Uuid::new_v4(),
            address: "1/0/1".to_string(),
            name: "Licht Küche".to_string(),
            dpt: "1.001".to_string(),
            description: "".to_string(),
            is_custom: true,
            ..Default::default()
        });

        // Add a device to both, with a parameter difference
        let mut dev_base = KnxDevice::default();
        dev_base.individual_address = "1.1.1".to_string();
        dev_base.name = "Schaltaktor".to_string();
        dev_base.parameters.push(crate::model::DeviceParameter {
            id: "mode".to_string(),
            name: "mode".to_string(),
            text: "Betriebsart".to_string(),
            param_type: "enum".to_string(),
            value: "Switch".to_string(),
            default_value: "Switch".to_string(),
            suffix: None,
            options: vec!["Switch".to_string(), "Staircase".to_string()],
            enum_options: vec![],
            page: None,
            pages: vec![],
            section: None,
            depends_on: None,
            ..Default::default()
        });

        let mut dev_comp = KnxDevice::default();
        dev_comp.individual_address = "1.1.1".to_string();
        dev_comp.name = "Schaltaktor EG".to_string();
        dev_comp.parameters.push(crate::model::DeviceParameter {
            id: "mode".to_string(),
            name: "mode".to_string(),
            text: "Betriebsart".to_string(),
            param_type: "enum".to_string(),
            value: "Staircase".to_string(),
            default_value: "Switch".to_string(),
            suffix: None,
            options: vec!["Switch".to_string(), "Staircase".to_string()],
            enum_options: vec![],
            page: None,
            pages: vec![],
            section: None,
            depends_on: None,
            ..Default::default()
        });

        base.devices.push(dev_base);
        compare.devices.push(dev_comp);

        let diff = ProjectComparer::compare(&base, &compare);
        assert_eq!(diff.group_addresses.len(), 2);
        assert_eq!(diff.devices.len(), 1);
        assert_eq!(diff.parameters.len(), 1);
        assert_eq!(diff.parameters[0].param_id, "mode");

        // Merge GA 1/0/1 selectively
        let merge_req = SelectiveMergeRequest {
            compare_project: None,
            compare_project_filename: None,
            merge_gas: vec!["1/0/1".to_string()],
            merge_devices: vec![],
            merge_parameters: vec![],
            merge_ko_links: vec![],
            merge_all: false,
        };

        let summary = ProjectComparer::apply_merge(&mut base, &compare, &merge_req);
        assert_eq!(summary.gas_merged, 1);
        assert_eq!(base.group_addresses.len(), 2);
        assert!(base.group_addresses.iter().any(|g| g.address == "1/0/1"));
    }
}
