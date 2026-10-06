use knx_core::diagnostics::DiagnosticsManager;
use knx_core::knxnet_ip::KnxNetManager;
use knx_core::knxprod::CatalogManager;
use knx_core::sample_data::create_demo_project;
use knx_core::server::{create_router, AppState};
use knx_core::simulator::Simulator;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "knx_core=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting KoNfiX Engine — Visual KNX Configurator");

    let storage = Arc::new(knx_core::storage::StorageManager::new());

    let initial_project = {
        let settings = storage.get_settings().await;
        let mut loaded = None;

        // 1. Try loading the active project from storage
        if let Some(active_name) = &settings.active_project_name {
            if let Ok(p) = storage.load_project(active_name).await {
                info!("Loaded active project '{}' from ~/.konfix ({} GAs, {} devices)", p.name, p.group_addresses.len(), p.devices.len());
                loaded = Some(p);
            }
        }

        // 2. If no active project, try the first project in storage
        if loaded.is_none() {
            if let Ok(projects) = storage.list_projects().await {
                if let Some(first) = projects.first() {
                    if let Ok(p) = storage.load_project(&first.name).await {
                        info!("Loaded most recent project '{}' from ~/.konfix ({} GAs)", p.name, p.group_addresses.len());
                        loaded = Some(p);
                    }
                }
            }
        }

        // 3. Optional initial project seeding via KONFIX_INITIAL_PROJECT env var
        if loaded.is_none() {
            if let Ok(initial_path) = std::env::var("KONFIX_INITIAL_PROJECT") {
                if std::path::Path::new(&initial_path).exists() {
                    if let Ok(bytes) = std::fs::read(&initial_path) {
                        let password = std::env::var("KONFIX_PROJECT_PASSWORD").ok();
                        match knx_core::ets_import::parse_knxproj(&bytes, password.as_deref(), "Initiales Projekt") {
                            Ok(proj) => {
                                info!("Imported initial project from {} and saving...", initial_path);
                                let _ = storage.save_project(&proj, Some(&proj.name)).await;
                                loaded = Some(proj);
                            }
                            Err(e) => {
                                warn!("Could not parse initial project {}: {}", initial_path, e);
                            }
                        }
                    }
                }
            }
        }

        // 4. Fallback to demo project and save
        match loaded {
            Some(p) => p,
            None => {
                let demo = create_demo_project();
                let _ = storage.save_project(&demo, Some("Demo")).await;
                demo
            }
        }
    };

    let project = Arc::new(RwLock::new(initial_project));
    let simulator = Arc::new(Simulator::new(project.clone()));
    let knx_manager = Arc::new(KnxNetManager::new(simulator.clone()));
    let diagnostics = Arc::new(DiagnosticsManager::new(
        knx_manager.clone(),
        project.clone(),
        simulator.clone(),
    ));
    let catalog = Arc::new(CatalogManager::new());
    let programming = knx_core::programming::ProgrammingJobManager::new(
        project.clone(),
        knx_manager.clone(),
        Some(storage.clone()),
    );

    let recorder = Arc::new(RwLock::new(knx_core::recorder::TelegramRecorder::new(10_000)));

    let app_state = AppState {
        project,
        simulator,
        knx_manager,
        diagnostics,
        catalog,
        programming,
        storage,
        recorder,
    };

    // Auto-connect to physical KNX IP Secure gateway if gateway.knxkeys or KONFIX_KEYRING_PATH is present
    {
        let knx_mgr_init = app_state.knx_manager.clone();
        tokio::spawn(async move {
            let mut keyring_candidates = Vec::new();
            if let Ok(path) = std::env::var("KONFIX_KEYRING_PATH") {
                keyring_candidates.push(path);
            }
            if let Ok(home) = std::env::var("HOME") {
                keyring_candidates.push(format!("{}/.konfix/gateway.knxkeys", home));
            }
            keyring_candidates.push("gateway.knxkeys".to_string());

            let pass_env = std::env::var("KONFIX_KEYRING_PASSWORD").ok();
            let passwords = if let Some(p) = pass_env {
                vec![p]
            } else {
                vec!["".to_string()]
            };

            'outer: for keyring_path in keyring_candidates {
                if std::path::Path::new(&keyring_path).exists() {
                    if let Ok(xml_text) = std::fs::read_to_string(&keyring_path) {
                        for password in &passwords {
                            if let Ok(decrypted) = knx_core::keyring::parse_and_decrypt_knxkeys(&xml_text, password) {
                                if let Some(tunnel) = decrypted.tunnels.iter().find(|t| t.user_id == 3).or_else(|| decrypted.tunnels.first()) {
                                    let creds = knx_core::knx_secure::KnxSecureCredentials {
                                        user_id: tunnel.user_id,
                                        user_password: tunnel.password.clone(),
                                        device_authentication: tunnel.authentication.clone(),
                                    };
                                    let gw_ip = std::env::var("KONFIX_GATEWAY_IP").unwrap_or_else(|_| "192.168.1.120".to_string());
                                    let gw_port: u16 = std::env::var("KONFIX_GATEWAY_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3671);
                                    info!("Auto-connecting to KNX IP Secure Gateway {}:{} (Tunnel IA: {}, User ID: {})...", gw_ip, gw_port, tunnel.individual_address, tunnel.user_id);
                                    match knx_mgr_init.connect(&gw_ip, gw_port, Some(creds)).await {
                                        Ok(msg) => info!("KNX IP Secure auto-connected successfully: {}", msg),
                                        Err(e) => info!("KNX IP Secure auto-connect result: {}", e),
                                    }
                                    break 'outer;
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    let app = create_router(app_state.clone());

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    // Background automation tick loop (every 5 seconds)
    let sim_tick = app_state.simulator.clone();
    let knx_mgr_tick = app_state.knx_manager.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        let mut last_values: std::collections::HashMap<String, serde_json::Value> = std::collections::HashMap::new();
        loop {
            interval.tick().await;
            let emitted = sim_tick.tick_automation().await;
            if !emitted.is_empty() {
                let knx_status = knx_mgr_tick.get_status().await;
                if knx_status.connected {
                    for t in emitted {
                        let val = if t.value_formatted.starts_with("EIN") {
                            serde_json::json!(true)
                        } else if t.value_formatted.starts_with("AUS") {
                            serde_json::json!(false)
                        } else {
                            serde_json::json!(t.value_formatted)
                        };
                        if last_values.get(&t.destination) != Some(&val) {
                            last_values.insert(t.destination.clone(), val.clone());
                            let _ = knx_mgr_tick.send_telegram(&t.destination, &t.dpt, &val).await;
                        }
                    }
                }
            }
        }
    });

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("KNX Config Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
