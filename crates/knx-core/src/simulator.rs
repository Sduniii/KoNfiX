use crate::astro::{calculate_solar_position, compass_direction};
use crate::model::*;
use chrono::{Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulateAction {
    pub source_node_id: Uuid,
    pub pin: String,
    pub value: serde_json::Value,
}

pub struct Simulator {
    pub project: Arc<RwLock<Project>>,
    pub telegram_history: Arc<RwLock<VecDeque<KnxTelegram>>>,
    pub tx_telegram: broadcast::Sender<KnxTelegram>,
}

impl Simulator {
    pub fn new(project: Arc<RwLock<Project>>) -> Self {
        let (tx_telegram, _) = broadcast::channel(200);
        Self {
            project,
            telegram_history: Arc::new(RwLock::new(VecDeque::with_capacity(300))),
            tx_telegram,
        }
    }

    pub async fn emit_telegram(&self, telegram: KnxTelegram) {
        {
            let mut history = self.telegram_history.write().await;
            if history.len() >= 200 {
                history.pop_front();
            }
            history.push_back(telegram.clone());
        }
        let _ = self.tx_telegram.send(telegram);
    }

    /// Primary execution engine: evaluates an action, propagates signals along wires, and emits telegrams
    pub async fn handle_action(&self, action: SimulateAction) -> Vec<KnxTelegram> {
        let mut emitted = Vec::new();
        let mut proj = self.project.write().await;

        // Queue for wire signal propagation: (block_id, pin_name, value)
        let mut queue: VecDeque<(Uuid, String, serde_json::Value)> = VecDeque::new();
        queue.push_back((action.source_node_id, action.pin, action.value));

        let mut step_count = 0;
        const MAX_PROPAGATION_STEPS: usize = 48; // Prevent infinite wire loops

        while let Some((node_id, pin, value)) = queue.pop_front() {
            step_count += 1;
            if step_count > MAX_PROPAGATION_STEPS {
                tracing::warn!("Max wire propagation depth exceeded in automation engine!");
                break;
            }

            // Check if node is a KNX physical device
            if let Some(dev_idx) = proj.devices.iter().position(|d| d.id == node_id) {
                let dev = &proj.devices[dev_idx];
                let dev_addr = dev.individual_address.clone();

                let ko_num = if let Some(rest) = pin.strip_prefix("ko-") {
                    rest.parse::<u32>().ok()
                } else {
                    pin.parse::<u32>().ok()
                };

                let ko_opt = ko_num.and_then(|num| dev.communication_objects.iter().find(|k| k.number == num).cloned());

                if let Some(ko) = ko_opt {
                    let dpt_str = if !ko.dpt.is_empty() { ko.dpt.clone() } else { "1.001".to_string() };
                    let val_fmt = crate::dpt::format_dpt_json_value(&dpt_str, &value);

                    let ga_addr = ko.group_addresses.first().cloned().unwrap_or_else(|| "0/0/0".to_string());
                    let now = Utc::now().format("%H:%M:%S%.3f").to_string();

                    emitted.push(KnxTelegram {
                        id: Uuid::new_v4(),
                        timestamp: now,
                        source: dev_addr,
                        destination: ga_addr,
                        dpt: dpt_str,
                        value_raw: vec![],
                        value_formatted: val_fmt,
                        telegram_type: "Write (Gerät)".to_string(),
                    });
                }

                // Propagate along wire connections originating from this device & pin
                for conn in &proj.connections {
                    if conn.from_node_id == node_id && (conn.from_pin == pin || conn.from_pin.ends_with(&pin)) {
                        queue.push_back((conn.to_node_id, conn.to_pin.clone(), value.clone()));
                    }
                }
                continue;
            }

            // Find block
            let block_idx = match proj.blocks.iter().position(|b| b.id == node_id) {
                Some(idx) => idx,
                None => continue,
            };

            let block = &mut proj.blocks[block_idx];
            let mut changed_outputs: Vec<(String, serde_json::Value, String)> = Vec::new(); // (pin_name, value, dpt)
            let now = Utc::now().format("%H:%M:%S%.3f").to_string();

            match block.block_type {
                FunctionBlockType::LightController => {
                    let mut current_on = block.state.get("is_on").and_then(|v| v.as_bool()).unwrap_or(false);
                    let mut current_brightness = block.state.get("brightness").and_then(|v| v.as_u64()).unwrap_or(0);

                    if pin == "t" || pin == "sw" || pin.ends_with("-t") {
                        current_on = !current_on;
                        if current_on && current_brightness == 0 {
                            current_brightness = 100;
                        } else if !current_on {
                            current_brightness = 0;
                        }
                        changed_outputs.push(("sw".to_string(), serde_json::json!(current_on), "1.001".to_string()));
                        changed_outputs.push(("val".to_string(), serde_json::json!(current_brightness), "5.001".to_string()));
                    } else if pin == "val" || pin.ends_with("-val") {
                        if let Some(v) = value.as_u64() {
                            current_brightness = v.min(100);
                            current_on = current_brightness > 0;
                            changed_outputs.push(("sw".to_string(), serde_json::json!(current_on), "1.001".to_string()));
                            changed_outputs.push(("val".to_string(), serde_json::json!(current_brightness), "5.001".to_string()));
                        }
                    } else if pin == "on" || (pin == "in" && value.as_bool() == Some(true)) {
                        current_on = true;
                        current_brightness = 100;
                        changed_outputs.push(("sw".to_string(), serde_json::json!(true), "1.001".to_string()));
                        changed_outputs.push(("val".to_string(), serde_json::json!(100), "5.001".to_string()));
                    } else if pin == "off" || (pin == "in" && value.as_bool() == Some(false)) {
                        current_on = false;
                        current_brightness = 0;
                        changed_outputs.push(("sw".to_string(), serde_json::json!(false), "1.001".to_string()));
                        changed_outputs.push(("val".to_string(), serde_json::json!(0), "5.001".to_string()));
                    }

                    block.state = serde_json::json!({
                        "is_on": current_on,
                        "brightness": current_brightness,
                    });
                }

                FunctionBlockType::BlindController => {
                    let mut pos = block.state.get("position").or_else(|| block.state.get("current_position")).and_then(|v| v.as_u64()).unwrap_or(0);
                    let mut is_moving = false;

                    if pin == "up" || pin.ends_with("-in-up") {
                        pos = 0;
                        is_moving = true;
                        changed_outputs.push(("pos".to_string(), serde_json::json!(0), "5.001".to_string()));
                    } else if pin == "down" || pin.ends_with("-in-down") {
                        pos = 100;
                        is_moving = true;
                        changed_outputs.push(("pos".to_string(), serde_json::json!(100), "5.001".to_string()));
                    } else if pin == "stop" || pin.ends_with("-in-stop") {
                        is_moving = false;
                    } else if pin == "pos" || pin == "in-pos" || pin.ends_with("-in-pos") {
                        if let Some(v) = value.as_u64() {
                            pos = v.min(100);
                            is_moving = false;
                            changed_outputs.push(("pos".to_string(), serde_json::json!(pos), "5.001".to_string()));
                        }
                    } else if pin == "alarm" || pin == "wind_alarm" {
                        if value.as_bool() == Some(true) {
                            pos = 0; // Security position: fully UP
                            is_moving = true;
                            changed_outputs.push(("pos".to_string(), serde_json::json!(0), "5.001".to_string()));
                        }
                    }

                    block.state = serde_json::json!({
                        "position": pos,
                        "current_position": pos,
                        "is_moving": is_moving,
                        "blade_position": 50,
                    });
                }

                FunctionBlockType::ClimateController => {
                    let mut target = block.state.get("target_temp").and_then(|v| v.as_f64()).unwrap_or(21.0);
                    let mut act = block.state.get("current_temp").or_else(|| block.state.get("act_temp")).and_then(|v| v.as_f64()).unwrap_or(20.5);

                    if pin == "target_temp" || pin == "t_set" {
                        if let Some(v) = value.as_f64() {
                            target = v;
                            changed_outputs.push(("t_set".to_string(), serde_json::json!(target), "9.001".to_string()));
                        }
                    } else if pin == "act_temp" || pin == "in_temp" {
                        if let Some(v) = value.as_f64() {
                            act = v;
                        }
                    }

                    // Simple 2-point / PI valve calculation
                    let valve = if act < target {
                        ((target - act) * 40.0).clamp(0.0, 100.0) as u64
                    } else {
                        0
                    };

                    changed_outputs.push(("valve".to_string(), serde_json::json!(valve), "5.001".to_string()));

                    block.state = serde_json::json!({
                        "target_temp": target,
                        "act_temp": act,
                        "current_temp": act,
                        "valve_pwm": valve,
                    });
                }

                FunctionBlockType::LogicGate => {
                    let gate_type = block.parameters.get("gate_type").and_then(|v| v.as_str()).unwrap_or("AND");
                    let mut in1 = block.state.get("in1").and_then(|v| v.as_bool()).unwrap_or(false);
                    let mut in2 = block.state.get("in2").and_then(|v| v.as_bool()).unwrap_or(false);
                    let mut in3 = block.state.get("in3").and_then(|v| v.as_bool()).unwrap_or(false);
                    let mut prev_out = block.state.get("out").and_then(|v| v.as_bool()).unwrap_or(false);

                    if pin == "in1" {
                        in1 = value.as_bool().unwrap_or(false);
                    } else if pin == "in2" {
                        in2 = value.as_bool().unwrap_or(false);
                    } else if pin == "in3" {
                        in3 = value.as_bool().unwrap_or(false);
                    } else if pin == "set" && value.as_bool() == Some(true) {
                        prev_out = true;
                    } else if pin == "reset" && value.as_bool() == Some(true) {
                        prev_out = false;
                    }

                    let out_val = match gate_type {
                        "OR" => in1 || in2 || in3,
                        "XOR" => in1 ^ in2,
                        "NOT" => !in1,
                        "NAND" => !(in1 && in2),
                        "NOR" => !(in1 || in2),
                        "SR" => prev_out,
                        _ => in1 && in2, // AND
                    };

                    let out_inv = !out_val;

                    block.state = serde_json::json!({
                        "in1": in1,
                        "in2": in2,
                        "in3": in3,
                        "out": out_val,
                        "out_inv": out_inv,
                    });

                    changed_outputs.push(("out".to_string(), serde_json::json!(out_val), "1.001".to_string()));
                    changed_outputs.push(("out_inv".to_string(), serde_json::json!(out_inv), "1.001".to_string()));
                }

                FunctionBlockType::AstroSunProtection => {
                    // Parameters
                    let facade_deg = block.parameters.get("facade_orientation_deg").and_then(|v| v.as_f64()).unwrap_or(180.0);
                    let beam_angle = block.parameters.get("facade_beam_angle").and_then(|v| v.as_f64()).unwrap_or(120.0);
                    let wind_thresh = block.parameters.get("wind_alarm_threshold").and_then(|v| v.as_f64()).unwrap_or(12.0);
                    let lux_thresh = block.parameters.get("sun_brightness_threshold").and_then(|v| v.as_f64()).unwrap_or(35000.0);
                    let elev_min = block.parameters.get("sun_elevation_min").and_then(|v| v.as_f64()).unwrap_or(10.0);
                    let blind_pos = block.parameters.get("blind_protection_pos").and_then(|v| v.as_u64()).unwrap_or(80);
                    let blade_pos = block.parameters.get("blade_protection_pos").and_then(|v| v.as_u64()).unwrap_or(45);

                    // Inputs from state / pin
                    let mut wind_speed = block.state.get("wind_speed").and_then(|v| v.as_f64()).unwrap_or(2.5);
                    let mut rain = block.state.get("rain").and_then(|v| v.as_bool()).unwrap_or(false);
                    let mut lux = block.state.get("brightness").and_then(|v| v.as_f64()).unwrap_or(42000.0);
                    let mut temp = block.state.get("temp").and_then(|v| v.as_f64()).unwrap_or(22.5);
                    let mut lock = block.state.get("lock").and_then(|v| v.as_bool()).unwrap_or(false);

                    if pin == "wind_speed" || pin == "wind" {
                        if let Some(v) = value.as_f64() { wind_speed = v; }
                    } else if pin == "rain" {
                        rain = value.as_bool().unwrap_or(false);
                    } else if pin == "brightness" || pin == "lux" {
                        if let Some(v) = value.as_f64() { lux = v; }
                    } else if pin == "temp" {
                        if let Some(v) = value.as_f64() { temp = v; }
                    } else if pin == "lock" {
                        lock = value.as_bool().unwrap_or(false);
                    }

                    // Solar calculation
                    let (solar_azimuth, solar_elevation) = calculate_solar_position(Utc::now(), 51.5, 10.0);
                    let dir_text = compass_direction(solar_azimuth);

                    // Logic
                    let is_wind_alarm = wind_speed >= wind_thresh;
                    let diff = ((solar_azimuth - facade_deg + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
                    let sun_in_window = diff.abs() <= (beam_angle / 2.0);
                    let sun_bright = lux >= lux_thresh && solar_elevation >= elev_min;
                    let is_sun_protecting = sun_in_window && sun_bright && !lock && !is_wind_alarm && !rain;

                    let (target_pos, target_blade) = if is_wind_alarm || rain {
                        (0u64, 0u64) // Safety up
                    } else if is_sun_protecting {
                        (blind_pos, blade_pos)
                    } else {
                        (0u64, 0u64)
                    };

                    block.state = serde_json::json!({
                        "wind_speed": wind_speed,
                        "rain": rain,
                        "brightness": lux,
                        "temp": temp,
                        "lock": lock,
                        "calculated_azimuth": (solar_azimuth * 10.0).round() / 10.0,
                        "calculated_elevation": (solar_elevation * 10.0).round() / 10.0,
                        "solar_direction": dir_text,
                        "is_wind_alarm": is_wind_alarm,
                        "is_sun_protecting": is_sun_protecting,
                        "target_pos": target_pos,
                        "target_blade": target_blade,
                    });

                    changed_outputs.push(("wind_alarm".to_string(), serde_json::json!(is_wind_alarm), "1.005".to_string()));
                    changed_outputs.push(("sun_active".to_string(), serde_json::json!(is_sun_protecting), "1.001".to_string()));
                    changed_outputs.push(("target_pos".to_string(), serde_json::json!(target_pos), "5.001".to_string()));
                    changed_outputs.push(("target_blade".to_string(), serde_json::json!(target_blade), "5.001".to_string()));
                }

                FunctionBlockType::TimerScheduler => {
                    let on_time = block.parameters.get("on_time").and_then(|v| v.as_str()).unwrap_or("07:00");
                    let off_time = block.parameters.get("off_time").and_then(|v| v.as_str()).unwrap_or("22:00");
                    let mut enabled = block.state.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);

                    if pin == "enable" {
                        enabled = value.as_bool().unwrap_or(true);
                    }

                    let now_utc = Utc::now();
                    let current_time_str = format!("{:02}:{:02}", now_utc.hour(), now_utc.minute());
                    let is_in_window = current_time_str.as_str() >= on_time && current_time_str.as_str() < off_time;
                    let out_val = enabled && is_in_window;

                    block.state = serde_json::json!({
                        "enabled": enabled,
                        "is_active": out_val,
                        "current_time": current_time_str,
                    });

                    changed_outputs.push(("out".to_string(), serde_json::json!(out_val), "1.001".to_string()));
                }

                FunctionBlockType::ThresholdSwitch => {
                    let thresh_on = block.parameters.get("threshold_on").and_then(|v| v.as_f64()).unwrap_or(24.0);
                    let thresh_off = block.parameters.get("threshold_off").and_then(|v| v.as_f64()).unwrap_or(22.0);
                    let direction = block.parameters.get("direction").and_then(|v| v.as_str()).unwrap_or("Above");

                    let mut in_val = block.state.get("in_val").and_then(|v| v.as_f64()).unwrap_or(20.0);
                    let mut current_out = block.state.get("out").and_then(|v| v.as_bool()).unwrap_or(false);

                    if pin == "in_val" || pin == "in" {
                        if let Some(v) = value.as_f64() { in_val = v; }
                    }

                    if direction == "Above" {
                        if in_val >= thresh_on { current_out = true; }
                        else if in_val <= thresh_off { current_out = false; }
                    } else {
                        if in_val <= thresh_on { current_out = true; }
                        else if in_val >= thresh_off { current_out = false; }
                    }

                    block.state = serde_json::json!({
                        "in_val": in_val,
                        "out": current_out,
                    });

                    changed_outputs.push(("out".to_string(), serde_json::json!(current_out), "1.001".to_string()));
                }

                FunctionBlockType::SceneController => {
                    let current_scene = block.state.get("active_scene").and_then(|v| v.as_u64()).unwrap_or(1);
                    let total_scenes = block.parameters.get("scenes")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.len() as u64)
                        .unwrap_or(5).max(1);

                    let mut scene_no = current_scene;

                    if pin == "scene" || pin == "scene_in" || pin == "scene_ctrl" || pin.ends_with("-scene") {
                        if let Some(s) = value.as_u64() {
                            scene_no = s;
                        }
                    } else if pin == "trig" || pin == "next" || pin.ends_with("-trig") {
                        scene_no = (current_scene % total_scenes) + 1;
                    } else if pin == "prev" || pin.ends_with("-prev") {
                        scene_no = if current_scene <= 1 { total_scenes } else { current_scene - 1 };
                    } else if pin == "all_off" || pin.ends_with("-all_off") {
                        scene_no = total_scenes; // Convention: last scene is Alles Aus
                    }

                    // Look up scene details from block parameters or fallback defaults
                    let (scene_name, scene_icon, values_map) = if let Some(scenes_arr) = block.parameters.get("scenes").and_then(|v| v.as_array()) {
                        let matched = scenes_arr.iter().find(|sc| {
                            sc.get("no").and_then(|n| n.as_u64()) == Some(scene_no)
                        }).or_else(|| scenes_arr.get(scene_no.saturating_sub(1) as usize));

                        if let Some(sc) = matched {
                            let name = sc.get("name").and_then(|n| n.as_str()).unwrap_or("Stimmung").to_string();
                            let icon = sc.get("icon").and_then(|n| n.as_str()).unwrap_or("✨").to_string();
                            let vals = sc.get("values").cloned().unwrap_or(serde_json::json!({}));
                            (name, icon, vals)
                        } else {
                            (format!("Szene {}", scene_no), "✨".to_string(), serde_json::json!({}))
                        }
                    } else {
                        // Built-in standard lighting scenes
                        match scene_no {
                            1 => ("Normal / Hell".to_string(), "☀️".to_string(), serde_json::json!({ "c1": 90, "c2": 70, "c3": 80, "c4": 80 })),
                            2 => ("Kochen / Essen".to_string(), "🍳".to_string(), serde_json::json!({ "c1": 100, "c2": 80, "c3": 40, "c4": 100 })),
                            3 => ("TV / Relax".to_string(), "🍿".to_string(), serde_json::json!({ "c1": 0, "c2": 25, "c3": 45, "c4": 0 })),
                            4 => ("Nacht / Orientierung".to_string(), "🌙".to_string(), serde_json::json!({ "c1": 0, "c2": 10, "c3": 15, "c4": 0 })),
                            _ => ("Alles Aus".to_string(), "🌑".to_string(), serde_json::json!({ "c1": 0, "c2": 0, "c3": 0, "c4": 0 })),
                        }
                    };

                    let val_c1 = values_map.get("c1").and_then(|v| v.as_u64()).unwrap_or(0);
                    let val_c2 = values_map.get("c2").and_then(|v| v.as_u64()).unwrap_or(0);
                    let val_c3 = values_map.get("c3").and_then(|v| v.as_u64()).unwrap_or(0);
                    let val_c4 = values_map.get("c4").and_then(|v| v.as_u64()).unwrap_or(0);
                    let is_all_off = val_c1 == 0 && val_c2 == 0 && val_c3 == 0 && val_c4 == 0;

                    block.state = serde_json::json!({
                        "active_scene": scene_no,
                        "scene_name": scene_name,
                        "scene_icon": scene_icon,
                        "fader_values": {
                            "c1": val_c1,
                            "c2": val_c2,
                            "c3": val_c3,
                            "c4": val_c4
                        },
                        "is_all_off": is_all_off,
                    });

                    changed_outputs.push(("scene_ctrl".to_string(), serde_json::json!(scene_no), "18.001".to_string()));
                    changed_outputs.push(("scene".to_string(), serde_json::json!(scene_no), "18.001".to_string()));
                    changed_outputs.push(("all_off".to_string(), serde_json::json!(is_all_off), "1.001".to_string()));

                    changed_outputs.push(("ch1_val".to_string(), serde_json::json!(val_c1), "5.001".to_string()));
                    changed_outputs.push(("ch2_val".to_string(), serde_json::json!(val_c2), "5.001".to_string()));
                    changed_outputs.push(("ch3_val".to_string(), serde_json::json!(val_c3), "5.001".to_string()));
                    changed_outputs.push(("ch4_val".to_string(), serde_json::json!(val_c4), "5.001".to_string()));

                    changed_outputs.push(("ch1_sw".to_string(), serde_json::json!(val_c1 > 0), "1.001".to_string()));
                    changed_outputs.push(("ch2_sw".to_string(), serde_json::json!(val_c2 > 0), "1.001".to_string()));
                    changed_outputs.push(("ch3_sw".to_string(), serde_json::json!(val_c3 > 0), "1.001".to_string()));
                    changed_outputs.push(("ch4_sw".to_string(), serde_json::json!(val_c4 > 0), "1.001".to_string()));
                }

                FunctionBlockType::StaircaseTimer => {
                    let mut current_on = block.state.get("is_on").and_then(|v| v.as_bool()).unwrap_or(false);
                    if pin == "trig" || pin == "sw" {
                        current_on = true;
                    } else if pin == "stop" {
                        current_on = false;
                    }

                    block.state = serde_json::json!({
                        "is_on": current_on,
                    });

                    changed_outputs.push(("sw".to_string(), serde_json::json!(current_on), "1.001".to_string()));
                }
            }

            let block_id = proj.blocks[block_idx].id;
            let output_pins: Vec<(String, Option<Uuid>)> = proj.blocks[block_idx]
                .outputs
                .iter()
                .map(|p| (p.name.clone(), p.group_address_id))
                .collect();

            // Emit KNX telegram for each output connected to a GroupAddress
            for (out_pin, out_val, dpt) in &changed_outputs {
                let fallback_ga_id = output_pins.iter()
                    .find(|(name, _)| name == out_pin || out_pin.ends_with(name))
                    .and_then(|(_, gid)| *gid);

                let target_ga = proj.group_addresses.iter().find(|ga| {
                    ga.origin_block_id == Some(block_id) && ga.origin_pin_name.as_deref() == Some(out_pin)
                }).or_else(|| {
                    fallback_ga_id.and_then(|gid| proj.group_addresses.iter().find(|ga| ga.id == gid))
                });

                if let Some(ga) = target_ga {
                    let formatted = crate::dpt::format_dpt_json_value(&dpt, out_val);

                    emitted.push(KnxTelegram {
                        id: Uuid::new_v4(),
                        timestamp: now.clone(),
                        source: "1.1.200".to_string(),
                        destination: ga.address.clone(),
                        dpt: dpt.clone(),
                        value_raw: vec![],
                        value_formatted: formatted,
                        telegram_type: "Write (Engine)".to_string(),
                    });
                }

                // Propagate along wire connections: find connections from this block & pin
                for conn in &proj.connections {
                    if conn.from_node_id == block_id && (conn.from_pin == *out_pin || conn.from_pin.ends_with(out_pin)) {
                        queue.push_back((conn.to_node_id, conn.to_pin.clone(), out_val.clone()));
                    }
                }
            }
        }

        drop(proj);

        for t in &emitted {
            self.emit_telegram(t.clone()).await;
        }

        emitted
    }

    /// Periodic automation tick: updates solar position and ticks astro/scheduler blocks
    pub async fn tick_automation(&self) -> Vec<KnxTelegram> {
        let blocks_to_tick: Vec<(Uuid, FunctionBlockType)> = {
            let proj = self.project.read().await;
            proj.blocks
                .iter()
                .filter(|b| b.block_type == FunctionBlockType::AstroSunProtection || b.block_type == FunctionBlockType::TimerScheduler)
                .map(|b| (b.id, b.block_type.clone()))
                .collect()
        };

        let mut all_telegrams = Vec::new();
        for (id, _) in blocks_to_tick {
            let res = self.handle_action(SimulateAction {
                source_node_id: id,
                pin: "tick".to_string(),
                value: serde_json::json!(true),
            }).await;
            all_telegrams.extend(res);
        }

        all_telegrams
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[allow(deprecated)]
    async fn test_wire_propagation_logic_to_light() {
        let block_a_id = Uuid::new_v4();
        let block_b_id = Uuid::new_v4();

        let block_a = FunctionBlock {
            id: block_a_id,
            name: "ODER Gatter".to_string(),
            block_type: FunctionBlockType::LogicGate,
            room_id: None,
            position: Position { x: 0.0, y: 0.0 },
            inputs: vec![],
            outputs: vec![],
            parameters: serde_json::json!({ "gate_type": "OR" }),
            state: serde_json::json!({ "in1": false, "in2": false, "out": false }),
        };

        let block_b = FunctionBlock {
            id: block_b_id,
            name: "Licht Wohnzimmer".to_string(),
            block_type: FunctionBlockType::LightController,
            room_id: None,
            position: Position { x: 200.0, y: 0.0 },
            inputs: vec![],
            outputs: vec![],
            parameters: serde_json::json!({}),
            state: serde_json::json!({ "is_on": false, "brightness": 0 }),
        };

        let conn = WireConnection {
            id: Uuid::new_v4(),
            from_node_id: block_a_id,
            from_pin: "out".to_string(),
            to_node_id: block_b_id,
            to_pin: "in".to_string(),
        };

        let project = Arc::new(RwLock::new(Project {
            id: Uuid::new_v4(),
            name: "Test Wire".to_string(),
            ga_scheme: GaScheme::TradeRoomFunction,
            buildings: vec![],
            floors: vec![],
            rooms: vec![],
            devices: vec![],
            blocks: vec![block_a, block_b],
            connections: vec![conn],
            group_addresses: vec![],
            topology: None,
        }));

        let sim = Simulator::new(project.clone());

        // Action: Trigger in1 on LogicGate
        sim.handle_action(SimulateAction {
            source_node_id: block_a_id,
            pin: "in1".to_string(),
            value: serde_json::json!(true),
        }).await;

        let proj = project.read().await;
        let light = proj.blocks.iter().find(|b| b.id == block_b_id).unwrap();
        assert_eq!(light.state.get("is_on").unwrap().as_bool(), Some(true));
        assert_eq!(light.state.get("brightness").unwrap().as_u64(), Some(100));
    }

    #[tokio::test]
    async fn test_astro_sun_protection_wind_alarm() {
        let block_id = Uuid::new_v4();
        let block = FunctionBlock {
            id: block_id,
            name: "Astro Beschattung".to_string(),
            block_type: FunctionBlockType::AstroSunProtection,
            room_id: None,
            position: Position { x: 0.0, y: 0.0 },
            inputs: vec![],
            outputs: vec![],
            parameters: serde_json::json!({
                "wind_alarm_threshold": 12.0,
                "facade_orientation_deg": 180.0
            }),
            state: serde_json::json!({
                "wind_speed": 4.0,
                "is_wind_alarm": false
            }),
        };

        let project = Arc::new(RwLock::new(Project {
            id: Uuid::new_v4(),
            name: "Test Astro".to_string(),
            ga_scheme: GaScheme::TradeRoomFunction,
            buildings: vec![],
            floors: vec![],
            rooms: vec![],
            devices: vec![],
            blocks: vec![block],
            connections: vec![],
            group_addresses: vec![],
            topology: None,
        }));

        let sim = Simulator::new(project.clone());

        // Trigger wind speed = 16.5 m/s (Sturm)
        sim.handle_action(SimulateAction {
            source_node_id: block_id,
            pin: "wind_speed".to_string(),
            value: serde_json::json!(16.5),
        }).await;

        let proj = project.read().await;
        let b = proj.blocks.iter().find(|b| b.id == block_id).unwrap();
        assert_eq!(b.state.get("is_wind_alarm").unwrap().as_bool(), Some(true));
        assert_eq!(b.state.get("target_pos").unwrap().as_u64(), Some(0)); // Safety UP!
    }

    #[tokio::test]
    async fn test_scene_controller_wire_to_light() {
        let sc_id = Uuid::new_v4();
        let light_id = Uuid::new_v4();

        let sc_block = FunctionBlock {
            id: sc_id,
            name: "Lichtszenen".to_string(),
            block_type: FunctionBlockType::SceneController,
            room_id: None,
            position: Position { x: 0.0, y: 0.0 },
            inputs: vec![BlockPin {
                id: "scene".to_string(),
                name: "SCENE".to_string(),
                description: "Szene wählen".to_string(),
                dpt: DptType::Dpt18_001,
                direction: PinDirection::Input,
                group_address_id: None,
            }],
            outputs: vec![BlockPin {
                id: "ch1_val".to_string(),
                name: "ch1_val".to_string(),
                description: "Kreis 1 Dimmwert".to_string(),
                dpt: DptType::Dpt5_001,
                direction: PinDirection::Output,
                group_address_id: None,
            }],
            parameters: serde_json::json!({
                "scenes": [
                    { "no": 1, "name": "Normal", "values": { "c1": 50 } },
                    { "no": 2, "name": "Essen", "values": { "c1": 85 } },
                    { "no": 3, "name": "Aus", "values": { "c1": 0 } }
                ]
            }),
            state: serde_json::json!({
                "active_scene": 1,
                "fader_values": { "c1": 50 }
            }),
        };

        let light_block = FunctionBlock {
            id: light_id,
            name: "Deckenlampe".to_string(),
            block_type: FunctionBlockType::LightController,
            room_id: None,
            position: Position { x: 400.0, y: 0.0 },
            inputs: vec![BlockPin {
                id: "val".to_string(),
                name: "VAL".to_string(),
                description: "Helligkeit".to_string(),
                dpt: DptType::Dpt5_001,
                direction: PinDirection::Input,
                group_address_id: None,
            }],
            outputs: vec![],
            parameters: serde_json::json!({}),
            state: serde_json::json!({
                "is_on": false,
                "brightness": 0
            }),
        };

        let conn = WireConnection {
            id: Uuid::new_v4(),
            from_node_id: sc_id,
            from_pin: "ch1_val".to_string(),
            to_node_id: light_id,
            to_pin: "val".to_string(),
        };

        let project = Arc::new(RwLock::new(Project {
            id: Uuid::new_v4(),
            name: "Test Scenes".to_string(),
            ga_scheme: GaScheme::TradeRoomFunction,
            buildings: vec![],
            floors: vec![],
            rooms: vec![],
            devices: vec![],
            blocks: vec![sc_block, light_block],
            connections: vec![conn],
            group_addresses: vec![],
            topology: None,
        }));

        let sim = Simulator::new(project.clone());

        // Action: Recall Scene 2 ("Essen")
        sim.handle_action(SimulateAction {
            source_node_id: sc_id,
            pin: "scene".to_string(),
            value: serde_json::json!(2),
        }).await;

        let proj = project.read().await;
        let sc = proj.blocks.iter().find(|b| b.id == sc_id).unwrap();
        assert_eq!(sc.state.get("active_scene").unwrap().as_u64(), Some(2));
        assert_eq!(sc.state.get("scene_name").unwrap().as_str(), Some("Essen"));

        // LightController must have received 85% over the wire!
        let light = proj.blocks.iter().find(|b| b.id == light_id).unwrap();
        assert_eq!(light.state.get("is_on").unwrap().as_bool(), Some(true));
        assert_eq!(light.state.get("brightness").unwrap().as_u64(), Some(85));
    }

    #[tokio::test]
    async fn test_wire_propagation_device_taster_to_light_block() {
        let dev_id = Uuid::new_v4();
        let light_id = Uuid::new_v4();

        let ko_taster = CommunicationObject {
            id: "O-0".to_string(),
            number: 0,
            name: "Taste 1".to_string(),
            object_text: "Taste 1".to_string(),
            function_text: "Schalten".to_string(),
            dpt: "1.001".to_string(),
            object_size: "1 Bit".to_string(),
            flags: ComObjectFlags {
                communication: true,
                read: false,
                write: false,
                transmit: true,
                update: false,
            },
            group_address_ids: vec![],
            group_addresses: vec!["4/0/18".to_string()],
        };

        let dev = KnxDevice {
            id: dev_id,
            individual_address: "1.1.5".to_string(),
            manufacturer: "MDT".to_string(),
            model: "Glastaster".to_string(),
            name: "Taster WZ".to_string(),
            room_id: None,
            channels: vec![],
            position: None,
            order_number: None,
            application_program: None,
            mask_version: None,
            bus_current_ma: None,
            communication_objects: vec![ko_taster],
            parameters: vec![],
            assign_rules: vec![],
            visible_ko_numbers: vec![],
            last_flashed_state: None,
            security: None,
            loaded_image: None,
            checksums: None,
        };

        let light_block = FunctionBlock {
            id: light_id,
            name: "Deckenlampe".to_string(),
            block_type: FunctionBlockType::LightController,
            room_id: None,
            position: Position { x: 300.0, y: 0.0 },
            inputs: vec![BlockPin {
                id: "sw".to_string(),
                name: "SW".to_string(),
                description: "Schalten".to_string(),
                dpt: DptType::Dpt1_001,
                direction: PinDirection::Input,
                group_address_id: None,
            }],
            outputs: vec![],
            parameters: serde_json::json!({}),
            state: serde_json::json!({
                "is_on": false,
                "brightness": 0
            }),
        };

        let conn = WireConnection {
            id: Uuid::new_v4(),
            from_node_id: dev_id,
            from_pin: "ko-0".to_string(),
            to_node_id: light_id,
            to_pin: "sw".to_string(),
        };

        let project = Arc::new(RwLock::new(Project {
            id: Uuid::new_v4(),
            name: "Test Dev Wiring".to_string(),
            ga_scheme: GaScheme::TradeRoomFunction,
            buildings: vec![],
            floors: vec![],
            rooms: vec![],
            devices: vec![dev],
            blocks: vec![light_block],
            connections: vec![conn],
            group_addresses: vec![],
            topology: None,
        }));

        let sim = Simulator::new(project.clone());

        // Action: Push button on Taster Device (ko-0 = true)
        let telegrams = sim.handle_action(SimulateAction {
            source_node_id: dev_id,
            pin: "ko-0".to_string(),
            value: serde_json::json!(true),
        }).await;

        // Verify that telegram was emitted for 1.1.5 -> 4/0/18
        assert!(!telegrams.is_empty());
        assert_eq!(telegrams[0].source, "1.1.5");
        assert_eq!(telegrams[0].destination, "4/0/18");
        assert_eq!(telegrams[0].value_formatted, "EIN (1)");

        // Verify that LightController state turned ON over the wire!
        let proj = project.read().await;
        let light = proj.blocks.iter().find(|b| b.id == light_id).unwrap();
        assert_eq!(light.state.get("is_on").unwrap().as_bool(), Some(true));
        assert_eq!(light.state.get("brightness").unwrap().as_u64(), Some(100));
    }
}


