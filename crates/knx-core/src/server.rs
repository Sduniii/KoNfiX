use crate::ets_import::{
    find_local_import_files, parse_ets_csv, parse_knxproj, DetectedImportFile, ImportSummary,
};
use crate::auto_ga::AutoGaRouter;
use crate::ets_export::EtsExporter;
use crate::knxnet_ip::{KnxNetManager, KNX_PORT};
use crate::model::*;
use crate::simulator::{SimulateAction, Simulator};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxPath, Query, State,
    },
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::prelude::*;
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use uuid::Uuid;

use crate::diagnostics::{
    DeviceDetailedInfo, DeviceProgModeInfo, DiagnosticsManager, LineScanProgress,
    ProgramAddressRequest, ProgramAddressResult, ScannedAddressInfo,
};
use crate::knxprod::CatalogManager;
use crate::topology::TopologyManager;
use crate::programming::ProgrammingJobManager;
use crate::storage::{ProjectMetadata, StorageManager, StorageSettings};

#[derive(Clone)]
pub struct AppState {
    pub project: Arc<RwLock<Project>>,
    pub simulator: Arc<Simulator>,
    pub knx_manager: Arc<KnxNetManager>,
    pub diagnostics: Arc<DiagnosticsManager>,
    pub catalog: Arc<CatalogManager>,
    pub programming: Arc<ProgrammingJobManager>,
    pub storage: Arc<StorageManager>,
}

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut router = Router::new()
        .route("/api/version", get(handle_get_version))
        .route("/api/project", get(get_project).post(update_project))
        .route("/api/project/summary", get(handle_project_summary))
        .route("/api/project/auto-route", post(trigger_auto_route))
        .route("/api/project/export/ets-csv", get(export_ets_csv))
        .route("/api/project/export/ets-xml", get(export_ets_xml))
        .route("/api/project/export/knxproj", get(export_knxproj_get).post(export_knxproj_post))
        .route("/api/devices/by-address/:address", get(handle_get_device_by_address))
        .route("/api/knx/read", post(handle_knx_read_group_address))
        .route("/api/storage/settings", get(handle_storage_get_settings).post(handle_storage_update_settings))
        .route("/api/storage/projects", get(handle_storage_list_projects))
        .route("/api/storage/projects/save", post(handle_storage_save_project))
        .route("/api/storage/projects/load", post(handle_storage_load_project))
        .route("/api/storage/projects/new", post(handle_storage_new_project))
        .route("/api/storage/view", get(handle_storage_get_view).post(handle_storage_save_view))
        .route("/api/simulate/action", post(handle_simulate_action))
        .route("/api/knx/discover", get(handle_knx_discover))
        .route("/api/knx/connect", post(handle_knx_connect))
        .route("/api/knx/disconnect", post(handle_knx_disconnect))
        .route("/api/knx/status", get(handle_knx_status))
        .route("/api/knx/keyring/local-files", get(handle_keyring_local_files))
        .route("/api/knx/keyring/decrypt", post(handle_keyring_decrypt))
        .route("/api/knx/connect-keyring", post(handle_knx_connect_keyring))
        .route("/api/knx/import/local-files", get(handle_import_local_files))
        .route("/api/knx/import/csv", post(handle_import_csv))
        .route("/api/knx/import/knxproj", post(handle_import_knxproj))
        .route("/api/knx/send", post(handle_knx_send_telegram))
        .route("/api/diagnostics/results", get(handle_diag_results))
        .route("/api/diagnostics/progress", get(handle_diag_progress))
        .route("/api/diagnostics/scan/start", post(handle_diag_scan_start))
        .route("/api/diagnostics/scan/stop", post(handle_diag_scan_stop))
        .route("/api/diagnostics/prog-mode/scan", post(handle_diag_prog_mode_scan))
        .route("/api/diagnostics/prog-mode/devices", get(handle_diag_prog_mode_devices))
        .route("/api/diagnostics/device-info", post(handle_diag_device_info))
        .route("/api/diagnostics/program-address", post(handle_diag_program_address))
        .route("/api/catalog/products", get(handle_catalog_products))
        .route("/api/catalog/products/:id", get(handle_catalog_product_detail))
        .route("/api/catalog/import-knxprod", post(handle_catalog_import_knxprod))
        .route("/api/catalog/create-device", post(handle_catalog_create_device))
        .route("/api/catalog/download-default", post(handle_catalog_download_default))
        .route("/api/catalog/sync-project", post(handle_catalog_sync_project))
        .route("/api/devices/:device_id/kos/:ko_number/link-ga", post(handle_device_ko_link_ga))
        .route("/api/devices/:device_id/parameters", axum::routing::put(handle_device_update_parameters))
        .route("/api/devices/:device_id/position", post(handle_device_position))
        .route("/api/wiring/connect", post(handle_wiring_connect))
        .route("/api/wiring/disconnect", post(handle_wiring_disconnect))
        .route("/api/topology", get(handle_get_topology))
        .route("/api/topology/areas", post(handle_add_area))
        .route("/api/topology/lines", post(handle_add_line))
        .route("/api/topology/lines/:line_id", axum::routing::put(handle_update_line).delete(handle_delete_line))
        .route("/api/topology/lines/:line_id/filter-table", get(handle_get_filter_table))
        .route("/api/topology/devices/move", post(handle_move_device))
        .route("/api/topology/validate", get(handle_validate_topology))
        .route("/api/programming/jobs", get(handle_get_programming_jobs).post(handle_create_programming_job))
        .route("/api/programming/jobs/:job_id", axum::routing::delete(handle_cancel_programming_job))
        .route("/api/programming/lines/:line_id/flash-filter-table", post(handle_flash_filter_table))
        .route("/api/devices/:device_id/dirty", get(handle_device_dirty_state))
        .route("/api/devices/:device_id/read-state", post(handle_read_device_live_state))
        .route("/api/devices/:device_id/mark-synced", post(handle_mark_device_synced))
        .route("/api/devices/:device_id/security", post(handle_device_security))
        .route("/ws/bus", get(ws_bus_handler));

    let dist_candidates = ["apps/web/dist", "../apps/web/dist", "../../apps/web/dist", "dist"];
    for dist_dir in dist_candidates {
        if Path::new(dist_dir).exists() {
            router = router.fallback_service(ServeDir::new(dist_dir));
            break;
        }
    }

    router
        .layer(axum::extract::DefaultBodyLimit::max(128 * 1024 * 1024))
        .layer(cors)
        .with_state(state)
}

async fn auto_save_if_enabled(state: &AppState, proj: &Project) {
    if state.storage.get_settings().await.auto_save {
        let _ = state.storage.save_project(proj, None).await;
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AppVersionInfo {
    pub version: &'static str,
    pub name: &'static str,
}

async fn handle_get_version() -> Json<AppVersionInfo> {
    Json(AppVersionInfo {
        version: env!("CARGO_PKG_VERSION"),
        name: env!("CARGO_PKG_NAME"),
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectSummaryResponse {
    pub project_name: String,
    pub building_count: usize,
    pub floor_count: usize,
    pub room_count: usize,
    pub rooms: Vec<RoomSummaryItem>,
    pub device_count: usize,
    pub group_address_count: usize,
    pub gateway_connected: bool,
    pub gateway_ip: Option<String>,
    pub individual_address: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RoomSummaryItem {
    pub id: Uuid,
    pub name: String,
    pub device_count: usize,
}

async fn handle_project_summary(State(state): State<AppState>) -> Json<ProjectSummaryResponse> {
    let proj = state.project.read().await;
    let knx_status = state.knx_manager.get_status().await;

    let rooms = proj.rooms.iter().map(|r| {
        let dev_count = proj.devices.iter().filter(|d| d.room_id == Some(r.id)).count();
        RoomSummaryItem {
            id: r.id,
            name: r.name.clone(),
            device_count: dev_count,
        }
    }).collect();

    Json(ProjectSummaryResponse {
        project_name: proj.name.clone(),
        building_count: proj.buildings.len(),
        floor_count: proj.floors.len(),
        room_count: proj.rooms.len(),
        rooms,
        device_count: proj.devices.len(),
        group_address_count: proj.group_addresses.len(),
        gateway_connected: knx_status.connected,
        gateway_ip: knx_status.gateway_ip,
        individual_address: knx_status.individual_address,
    })
}

async fn handle_get_device_by_address(
    State(state): State<AppState>,
    axum::extract::Path(address): axum::extract::Path<String>,
) -> Result<Json<KnxDevice>, (StatusCode, Json<serde_json::Value>)> {
    let proj = state.project.read().await;
    let clean = address.trim();
    if let Some(dev) = proj.devices.iter().find(|d| d.individual_address == clean) {
        Ok(Json(dev.clone()))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": format!("Gerät mit Adresse '{}' nicht gefunden", clean) })),
        ))
    }
}

async fn get_project(State(state): State<AppState>) -> Json<Project> {
    let proj = state.project.read().await;
    Json(proj.clone())
}

async fn update_project(
    State(state): State<AppState>,
    Json(mut updated): Json<Project>,
) -> Json<Project> {
    AutoGaRouter::route_project(&mut updated);
    let mut proj = state.project.write().await;
    *proj = updated.clone();
    drop(proj);

    auto_save_if_enabled(&state, &updated).await;

    Json(updated)
}

async fn trigger_auto_route(State(state): State<AppState>) -> Json<Project> {
    let mut proj = state.project.write().await;
    AutoGaRouter::route_project(&mut proj);
    let cloned = proj.clone();
    drop(proj);

    auto_save_if_enabled(&state, &cloned).await;

    Json(cloned)
}

async fn export_ets_csv(State(state): State<AppState>) -> impl IntoResponse {
    let proj = state.project.read().await;
    let csv_content = EtsExporter::to_ets_csv(&proj);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "text/csv; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        "attachment; filename=\"knx_group_addresses.csv\""
            .parse()
            .unwrap(),
    );

    (headers, csv_content)
}

async fn export_ets_xml(State(state): State<AppState>) -> impl IntoResponse {
    let proj = state.project.read().await;
    let xml_content = EtsExporter::to_ets_xml(&proj);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "application/xml; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        "attachment; filename=\"knx_project_export.xml\""
            .parse()
            .unwrap(),
    );

    (headers, xml_content)
}

#[derive(serde::Deserialize)]
struct ExportKnxprojParams {
    password: Option<String>,
}

async fn export_knxproj_get(
    State(state): State<AppState>,
    Query(params): Query<ExportKnxprojParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let proj = state.project.read().await;
    let safe_name = proj.name.replace(' ', "_").replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let filename = format!("{}.knxproj", if safe_name.is_empty() { "knx_project" } else { &safe_name });
    let bytes = EtsExporter::export_knxproj(&proj, params.password.as_deref())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", filename).parse().unwrap(),
    );

    Ok((headers, bytes))
}

async fn export_knxproj_post(
    State(state): State<AppState>,
    Json(params): Json<ExportKnxprojParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let proj = state.project.read().await;
    let safe_name = proj.name.replace(' ', "_").replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let filename = format!("{}.knxproj", if safe_name.is_empty() { "knx_project" } else { &safe_name });
    let bytes = EtsExporter::export_knxproj(&proj, params.password.as_deref())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", filename).parse().unwrap(),
    );

    Ok((headers, bytes))
}

#[derive(serde::Deserialize)]
struct UpdateStorageSettingsReq {
    data_dir: String,
    migrate: Option<bool>,
}

#[derive(serde::Deserialize)]
struct SaveProjectReq {
    name: Option<String>,
    project: Option<Project>,
}

#[derive(serde::Deserialize)]
struct LoadProjectReq {
    name: String,
}

#[derive(serde::Deserialize)]
struct NewProjectReq {
    name: String,
}

async fn handle_storage_get_settings(State(state): State<AppState>) -> Json<StorageSettings> {
    Json(state.storage.get_settings().await)
}

async fn handle_storage_update_settings(
    State(state): State<AppState>,
    Json(req): Json<UpdateStorageSettingsReq>,
) -> Result<Json<StorageSettings>, (StatusCode, String)> {
    state
        .storage
        .update_data_dir(&req.data_dir, req.migrate.unwrap_or(true))
        .await
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

async fn handle_storage_list_projects(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProjectMetadata>>, (StatusCode, String)> {
    state
        .storage
        .list_projects()
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn handle_storage_save_project(
    State(state): State<AppState>,
    Json(req): Json<SaveProjectReq>,
) -> Result<Json<ProjectMetadata>, (StatusCode, String)> {
    if let Some(ref new_proj) = req.project {
        let mut proj_lock = state.project.write().await;
        *proj_lock = new_proj.clone();
    }
    let proj = state.project.read().await;
    let meta = state
        .storage
        .save_project(&proj, req.name.as_deref())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(meta))
}

async fn handle_storage_load_project(
    State(state): State<AppState>,
    Json(req): Json<LoadProjectReq>,
) -> Result<Json<Project>, (StatusCode, String)> {
    let loaded = state
        .storage
        .load_project(&req.name)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, e))?;

    let mut proj = state.project.write().await;
    *proj = loaded.clone();
    drop(proj);

    Ok(Json(loaded))
}

async fn handle_storage_new_project(
    State(state): State<AppState>,
    Json(req): Json<NewProjectReq>,
) -> Result<Json<Project>, (StatusCode, String)> {
    let new_proj = Project {
        id: Uuid::new_v4(),
        name: req.name.clone(),
        ga_scheme: GaScheme::TradeRoomFunction,
        buildings: vec![Building {
            id: Uuid::new_v4(),
            name: "Hauptgebäude".to_string(),
        }],
        floors: vec![Floor {
            id: Uuid::new_v4(),
            building_id: Uuid::new_v4(),
            name: "Erdgeschoss".to_string(),
            level: 0,
        }],
        rooms: vec![],
        devices: vec![],
        blocks: vec![],
        connections: vec![],
        group_addresses: vec![],
        topology: None,
    };

    let _ = state
        .storage
        .save_project(&new_proj, Some(&req.name))
        .await;

    let mut proj = state.project.write().await;
    *proj = new_proj.clone();
    drop(proj);

    Ok(Json(new_proj))
}

async fn handle_storage_get_view(
    State(state): State<AppState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Json<Option<serde_json::Value>> {
    let s = state.storage.get_settings().await;
    let name = params
        .get("project")
        .cloned()
        .or(s.active_project_name)
        .unwrap_or_else(|| "default".to_string());
    Json(state.storage.load_view(&name).await)
}

async fn handle_storage_save_view(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let s = state.storage.get_settings().await;
    let proj_name = payload
        .get("project")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(s.active_project_name)
        .unwrap_or_else(|| "default".to_string());

    state
        .storage
        .save_view(&proj_name, payload.clone())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(payload))
}

async fn handle_simulate_action(
    State(state): State<AppState>,
    Json(action): Json<SimulateAction>,
) -> Json<Vec<KnxTelegram>> {
    let emitted = state.simulator.handle_action(action.clone()).await;

    // If a physical KNXnet/IP tunnel is active, forward the telegram live to the bus!
    let knx_status = state.knx_manager.get_status().await;
    if knx_status.connected {
        let proj = state.project.read().await;
        let ga_opt = proj
            .group_addresses
            .iter()
            .find(|g| {
                g.origin_block_id == Some(action.source_node_id)
                    && g.origin_pin_name.as_deref() == Some(&action.pin)
            })
            .or_else(|| {
                if action.pin == "t" || action.pin == "p" {
                    proj.group_addresses.iter().find(|g| {
                        g.origin_block_id == Some(action.source_node_id)
                            && g.origin_pin_name.as_deref() == Some("sw")
                    })
                } else if action.pin == "up" || action.pin == "down" {
                    proj.group_addresses.iter().find(|g| {
                        g.origin_block_id == Some(action.source_node_id)
                            && g.origin_pin_name.as_deref() == Some("move")
                    })
                } else {
                    None
                }
            })
            .cloned()
            .or_else(|| {
                // Check if source_node_id is a KnxDevice with a KO!
                let ko_num = if let Some(rest) = action.pin.strip_prefix("ko-") {
                    rest.parse::<u32>().ok()
                } else {
                    action.pin.parse::<u32>().ok()
                };
                if let Some(dev) = proj.devices.iter().find(|d| d.id == action.source_node_id) {
                    if let Some(num) = ko_num {
                        if let Some(ko) = dev.communication_objects.iter().find(|k| k.number == num) {
                            if let Some(addr) = ko.group_addresses.first() {
                                return proj.group_addresses.iter().find(|g| &g.address == addr).cloned();
                            }
                        }
                    }
                }
                None
            });

        if let Some(ga) = ga_opt {
            let _ = state
                .knx_manager
                .send_telegram(&ga.address, &ga.dpt, &action.value)
                .await;
        }
    }

    Json(emitted)
}

async fn handle_knx_discover(State(state): State<AppState>) -> Json<Vec<DiscoveredGateway>> {
    let gateways = state.knx_manager.discover(1800).await;
    Json(gateways)
}

async fn handle_knx_connect(
    State(state): State<AppState>,
    Json(req): Json<GatewayConnectRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let port = req.port.unwrap_or(KNX_PORT);
    match state.knx_manager.connect(&req.ip, port, req.secure).await {
        Ok(msg) => Ok(Json(serde_json::json!({
            "success": true,
            "message": msg
        }))),
        Err(err) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "success": false,
                "error": err
            })),
        )),
    }
}

async fn handle_knx_disconnect(State(state): State<AppState>) -> Json<serde_json::Value> {
    let _ = state.knx_manager.disconnect().await;
    Json(serde_json::json!({ "success": true }))
}

async fn handle_knx_status(State(state): State<AppState>) -> Json<GatewayConnectionStatus> {
    let status = state.knx_manager.get_status().await;
    Json(status)
}

#[derive(serde::Deserialize)]
pub struct KeyringDecryptReq {
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub password: String,
}

#[derive(serde::Deserialize)]
pub struct ConnectKeyringReq {
    pub ip: String,
    pub port: Option<u16>,
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub password: String,
    pub user_id: Option<u8>,
}

async fn handle_keyring_local_files() -> Json<Vec<String>> {
    Json(crate::keyring::find_local_knxkeys_files())
}

async fn handle_keyring_decrypt(
    Json(req): Json<KeyringDecryptReq>,
) -> Result<Json<crate::keyring::DecryptedKeyring>, (StatusCode, Json<serde_json::Value>)> {
    let xml_text = if let Some(path) = req.file_path {
        std::fs::read_to_string(&path)
            .map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": format!("Fehler beim Lesen der Datei {}: {}", path, e) }))))?
    } else if let Some(content) = req.content {
        content
    } else {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Weder Datei noch Inhalt übergeben." }))));
    };

    match crate::keyring::parse_and_decrypt_knxkeys(&xml_text, &req.password) {
        Ok(decrypted) => Ok(Json(decrypted)),
        Err(err) => Err((StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": err })))),
    }
}

async fn handle_knx_connect_keyring(
    State(state): State<AppState>,
    Json(req): Json<ConnectKeyringReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let xml_text = if let Some(path) = req.file_path {
        std::fs::read_to_string(&path)
            .map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": format!("Fehler beim Lesen der Datei {}: {}", path, e) }))))?
    } else if let Some(content) = req.content {
        content
    } else {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Weder Datei noch Inhalt übergeben." }))));
    };

    let decrypted = crate::keyring::parse_and_decrypt_knxkeys(&xml_text, &req.password)
        .map_err(|err| (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": err }))))?;

    if decrypted.tunnels.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Keine Tunneling-Verbindungen im Schlüsselbund gefunden." }))));
    }

    // Pick tunnel: prefer requested user_id, or user_id 3, 4, 5, then 2
    let chosen_tunnel = if let Some(uid) = req.user_id {
        decrypted.tunnels.iter().find(|t| t.user_id == uid)
    } else {
        decrypted.tunnels.iter().find(|t| t.user_id == 3)
            .or_else(|| decrypted.tunnels.iter().find(|t| t.user_id == 4))
            .or_else(|| decrypted.tunnels.iter().find(|t| t.user_id == 5))
            .or_else(|| decrypted.tunnels.iter().find(|t| t.user_id == 2))
            .or_else(|| decrypted.tunnels.first())
    }.ok_or_else(|| (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Gewählter Tunnel nicht gefunden." }))))?;

    let secure_creds = KnxSecureCredentials {
        user_id: chosen_tunnel.user_id,
        user_password: chosen_tunnel.password.clone(),
        device_authentication: chosen_tunnel.authentication.clone(),
    };

    let port = req.port.unwrap_or(KNX_PORT);
    match state.knx_manager.connect(&req.ip, port, Some(secure_creds)).await {
        Ok(msg) => Ok(Json(serde_json::json!({
            "success": true,
            "message": msg,
            "tunnel_used": chosen_tunnel.user_id,
            "tunnel_ia": chosen_tunnel.individual_address,
            "project": decrypted.project_name
        }))),
        Err(err) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
            "success": false,
            "error": err
        })))),
    }
}

async fn ws_bus_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let mut rx = state.simulator.tx_telegram.subscribe();
    let mut diag_rx = state.diagnostics.tx_events.subscribe();

    // Send recent history to newly connected client
    {
        let history = state.simulator.telegram_history.read().await;
        for telegram in history.iter() {
            if let Ok(msg) = serde_json::to_string(&telegram) {
                if socket.send(Message::Text(msg)).await.is_err() {
                    return;
                }
            }
        }
    }

    let (mut sender, mut receiver) = socket.split();

    // Task to forward telegrams and diagnostics events to client
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                res = rx.recv() => {
                    match res {
                        Ok(telegram) => {
                            if let Ok(msg) = serde_json::to_string(&telegram) {
                                if sender.send(Message::Text(msg)).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
                res = diag_rx.recv() => {
                    match res {
                        Ok(diag_event) => {
                            if let Ok(msg) = serde_json::to_string(&diag_event) {
                                if sender.send(Message::Text(msg)).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            }
        }
    });

    // Task to receive incoming client actions
    let sim = state.simulator.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = receiver.next().await {
            if let Ok(action) = serde_json::from_str::<SimulateAction>(&text) {
                sim.handle_action(action).await;
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };
}

#[derive(Debug, serde::Deserialize)]
pub struct ImportCsvRequest {
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub project_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct ImportKnxprojRequest {
    pub file_path: Option<String>,
    pub content_base64: Option<String>,
    pub password: Option<String>,
    pub project_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct SendTelegramRequest {
    pub destination: String,
    pub dpt: String,
    pub value: serde_json::Value,
}

async fn handle_import_local_files() -> Json<Vec<DetectedImportFile>> {
    Json(find_local_import_files())
}

async fn handle_import_csv(
    State(state): State<AppState>,
    Json(req): Json<ImportCsvRequest>,
) -> Result<Json<ImportSummary>, (StatusCode, Json<serde_json::Value>)> {
    let content = if let Some(path_str) = req.file_path.as_deref() {
        let bytes = fs::read(path_str).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Konnte Datei nicht lesen: {}", e)})),
            )
        })?;
        match String::from_utf8(bytes.clone()) {
            Ok(s) => s,
            Err(_) => bytes.iter().map(|&b| b as char).collect(),
        }
    } else if let Some(c) = req.content {
        c
    } else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Weder file_path noch content angegeben."})),
        ));
    };

    let p_name = req
        .project_name
        .as_deref()
        .unwrap_or("KNX Importiertes Projekt");
    let imported_project = parse_ets_csv(&content, p_name)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))))?;

    let ga_count = imported_project.group_addresses.len();
    let room_count = imported_project.rooms.len();
    let floor_count = imported_project.floors.len();
    let block_count = imported_project.blocks.len();
    let file_name = req
        .file_path
        .unwrap_or_else(|| "ETS CSV Upload".to_string());

    {
        let mut proj = state.project.write().await;
        *proj = imported_project;
    }

    Ok(Json(ImportSummary {
        success: true,
        file_name,
        project_name: p_name.to_string(),
        group_address_count: ga_count,
        room_count,
        floor_count,
        block_count,
        message: format!(
            "{} Gruppenadressen, {} Räume und {} Bausteine erfolgreich importiert!",
            ga_count, room_count, block_count
        ),
    }))
}

async fn handle_import_knxproj(
    State(state): State<AppState>,
    Json(req): Json<ImportKnxprojRequest>,
) -> Result<Json<ImportSummary>, (StatusCode, Json<serde_json::Value>)> {
    let bytes = if let Some(path_str) = req.file_path.as_deref() {
        fs::read(path_str).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Konnte Datei nicht lesen: {}", e)})),
            )
        })?
    } else if let Some(b64) = req.content_base64.as_deref() {
        BASE64_STANDARD.decode(b64.trim()).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Ungültiges Base64: {}", e)})),
            )
        })?
    } else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Weder file_path noch content_base64 angegeben."})),
        ));
    };

    let p_name = req
        .project_name
        .as_deref()
        .unwrap_or("ETS KNX-Projekt");
    let mut imported_project = parse_knxproj(&bytes, req.password.as_deref(), p_name)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))))?;

    // Auto-enrich imported devices from catalog if matching products exist
    let enriched_count = state.catalog.enrich_all_devices(&mut imported_project).await;

    let ga_count = imported_project.group_addresses.len();
    let room_count = imported_project.rooms.len();
    let floor_count = imported_project.floors.len();
    let block_count = imported_project.blocks.len();
    let file_name = req
        .file_path
        .unwrap_or_else(|| "ETS .knxproj Upload".to_string());

    let msg = if enriched_count > 0 {
        format!(
            "{} Gruppenadressen, {} Räume und {} Bausteine importiert ({} Geräte automatisch mit der Produktdatenbank synchronisiert)!",
            ga_count, room_count, block_count, enriched_count
        )
    } else {
        format!(
            "{} Gruppenadressen, {} Räume und {} Bausteine erfolgreich importiert!",
            ga_count, room_count, block_count
        )
    };

    {
        let mut proj = state.project.write().await;
        *proj = imported_project;
    }

    Ok(Json(ImportSummary {
        success: true,
        file_name,
        project_name: p_name.to_string(),
        group_address_count: ga_count,
        room_count,
        floor_count,
        block_count,
        message: msg,
    }))
}

async fn handle_knx_send_telegram(
    State(state): State<AppState>,
    Json(req): Json<SendTelegramRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let target_dest = if req.destination.contains('/') {
        req.destination.clone()
    } else {
        let proj = state.project.read().await;
        let q = req.destination.trim().to_lowercase();
        proj.group_addresses.iter()
            .find(|g| g.name.to_lowercase().contains(&q))
            .map(|g| g.address.clone())
            .unwrap_or(req.destination.clone())
    };

    let tg_opt = state
        .knx_manager
        .send_telegram(&target_dest, &req.dpt, &req.value)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e})),
            )
        })?;

    if let Some(tg) = tg_opt {
        state.simulator.emit_telegram(tg.clone()).await;
        Ok(Json(serde_json::json!({
            "success": true,
            "destination": target_dest,
            "telegram": tg
        })))
    } else {
        // Even if not connected to physical gateway, emit to simulator
        let now = Utc::now().format("%H:%M:%S%.3f").to_string();
        let val_fmt = crate::dpt::format_dpt_json_value(&req.dpt, &req.value);
        let sim_tg = KnxTelegram {
            id: Uuid::new_v4(),
            timestamp: now,
            source: "1.1.255".to_string(),
            destination: target_dest.clone(),
            dpt: req.dpt,
            value_raw: vec![],
            value_formatted: val_fmt,
            telegram_type: "Write (SIM)".to_string(),
        };
        state.simulator.emit_telegram(sim_tg.clone()).await;
        Ok(Json(serde_json::json!({
            "success": true,
            "destination": target_dest,
            "telegram": sim_tg
        })))
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct ReadGroupAddressRequest {
    pub destination: String,
}

async fn handle_knx_read_group_address(
    State(state): State<AppState>,
    Json(req): Json<ReadGroupAddressRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let proj = state.project.read().await;
    let clean_dest = if req.destination.contains('/') {
        req.destination.clone()
    } else {
        let q = req.destination.trim().to_lowercase();
        proj.group_addresses.iter()
            .find(|g| g.name.to_lowercase().contains(&q))
            .map(|g| g.address.clone())
            .unwrap_or(req.destination.clone())
    };

    let ga_meta = proj.group_addresses.iter().find(|g| g.address == clean_dest);
    let knx_status = state.knx_manager.get_status().await;

    Ok(Json(serde_json::json!({
        "success": true,
        "destination": clean_dest,
        "name": ga_meta.map(|g| g.name.clone()),
        "dpt": ga_meta.map(|g| g.dpt.clone()),
        "gateway_connected": knx_status.connected,
    })))
}

#[derive(Debug, serde::Deserialize)]
pub struct StartScanRequest {
    pub line: String,
    pub start: Option<u8>,
    pub end: Option<u8>,
}

#[derive(Debug, serde::Deserialize)]
pub struct ProgModeScanRequest {
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, serde::Deserialize)]
pub struct DeviceInfoRequest {
    pub address: String,
}

async fn handle_diag_results(State(state): State<AppState>) -> Json<Vec<ScannedAddressInfo>> {
    Json(state.diagnostics.get_scan_results().await)
}

async fn handle_diag_progress(State(state): State<AppState>) -> Json<LineScanProgress> {
    Json(state.diagnostics.get_scan_progress().await)
}

async fn handle_diag_scan_start(
    State(state): State<AppState>,
    Json(req): Json<StartScanRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let start = req.start.unwrap_or(1);
    let end = req.end.unwrap_or(255);
    state
        .diagnostics
        .start_line_scan(&req.line, start, end)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))))?;
    Ok(Json(serde_json::json!({ "success": true, "message": "Scan gestartet" })))
}

async fn handle_diag_scan_stop(State(state): State<AppState>) -> Json<serde_json::Value> {
    state.diagnostics.stop_line_scan().await;
    Json(serde_json::json!({ "success": true, "message": "Scan gestoppt" }))
}

async fn handle_diag_prog_mode_scan(
    State(state): State<AppState>,
    Json(req): Json<ProgModeScanRequest>,
) -> Result<Json<Vec<DeviceProgModeInfo>>, (StatusCode, Json<serde_json::Value>)> {
    let timeout = req.timeout_ms.unwrap_or(1500);
    state
        .diagnostics
        .scan_programming_mode(timeout)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))))
}

async fn handle_diag_prog_mode_devices(State(state): State<AppState>) -> Json<Vec<DeviceProgModeInfo>> {
    Json(state.diagnostics.get_prog_mode_devices().await)
}

async fn handle_diag_device_info(
    State(state): State<AppState>,
    Json(req): Json<DeviceInfoRequest>,
) -> Result<Json<DeviceDetailedInfo>, (StatusCode, Json<serde_json::Value>)> {
    state
        .diagnostics
        .query_device_info(&req.address)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))))
}

async fn handle_diag_program_address(
    State(state): State<AppState>,
    Json(req): Json<ProgramAddressRequest>,
) -> Result<Json<ProgramAddressResult>, (StatusCode, Json<serde_json::Value>)> {
    let res = state
        .diagnostics
        .program_individual_address(&req.target_address, req.device_id)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))))?;

    let proj = state.project.read().await;
    auto_save_if_enabled(&state, &proj).await;

    Ok(Json(res))
}

#[derive(Debug, serde::Deserialize)]
pub struct ImportKnxprodRequest {
    pub file_path: Option<String>,
    pub data_base64: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateDeviceRequest {
    pub product_id: String,
    pub individual_address: String,
    pub custom_name: Option<String>,
    pub room_id: Option<Uuid>,
}

#[derive(Debug, serde::Deserialize)]
pub struct LinkGaRequest {
    pub group_address_id: Option<Uuid>,
    pub group_address: Option<String>,
    pub unlink: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateParametersRequest {
    pub parameters: Vec<ParamUpdate>,
}

#[derive(Debug, serde::Deserialize)]
pub struct ParamUpdate {
    pub id: String,
    pub value: String,
}

async fn handle_catalog_products(State(state): State<AppState>) -> Json<Vec<CatalogProductSummary>> {
    Json(state.catalog.get_all_summaries().await)
}

async fn handle_catalog_product_detail(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<CatalogProduct>, (StatusCode, Json<serde_json::Value>)> {
    match state.catalog.get_product(&id).await {
        Some(product) => Ok(Json(product)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": format!("Produkt '{}' nicht im Katalog gefunden", id) })),
        )),
    }
}

async fn handle_catalog_import_knxprod(
    State(state): State<AppState>,
    Json(req): Json<ImportKnxprodRequest>,
) -> Result<Json<Vec<CatalogProductSummary>>, (StatusCode, Json<serde_json::Value>)> {
    let bytes = if let Some(path_str) = req.file_path {
        fs::read(&path_str).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": format!("Datei konnte nicht gelesen werden: {}", e) })),
            )
        })?
    } else if let Some(b64) = req.data_base64 {
        BASE64_STANDARD.decode(&b64).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": format!("Ungültiges Base64: {}", e) })),
            )
        })?
    } else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Weder file_path noch data_base64 angegeben" })),
        ));
    };

    match state.catalog.import_knxprod_bytes(&bytes).await {
        Ok(products) => Ok(Json(products)),
        Err(err) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": err })),
        )),
    }
}

async fn handle_catalog_create_device(
    State(state): State<AppState>,
    Json(req): Json<CreateDeviceRequest>,
) -> Result<Json<KnxDevice>, (StatusCode, Json<serde_json::Value>)> {
    let mut dev = state
        .catalog
        .create_device_from_product(&req.product_id, &req.individual_address, req.custom_name.as_deref())
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))))?;

    if let Some(r_id) = req.room_id {
        for ch in &mut dev.channels {
            ch.room_id = Some(r_id);
        }
    }

    let mut proj = state.project.write().await;
    proj.devices.push(dev.clone());
    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    Ok(Json(dev))
}

async fn handle_catalog_download_default(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let count = state.catalog.scan_database_folder().await;
    let total = state.catalog.get_all_summaries().await.len();
    Ok(Json(serde_json::json!({
        "success": true,
        "loaded_count": count,
        "total_catalog_products": total,
        "message": format!("{} Produkte aus der Standard-Datenbank geladen (Gesamtkatalog: {} Produkte)", count, total)
    })))
}

async fn handle_catalog_sync_project(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let mut proj = state.project.write().await;
    let enriched_count = state.catalog.enrich_all_devices(&mut proj).await;
    let cloned = proj.clone();
    drop(proj);

    auto_save_if_enabled(&state, &cloned).await;

    Ok(Json(serde_json::json!({
        "success": true,
        "enriched_count": enriched_count,
        "message": format!("{} Geräte erfolgreich mit der Produktdatenbank synchronisiert", enriched_count),
        "project": cloned
    })))
}

async fn handle_device_ko_link_ga(
    State(state): State<AppState>,
    axum::extract::Path((device_id, ko_number)): axum::extract::Path<(Uuid, u32)>,
    Json(req): Json<LinkGaRequest>,
) -> Result<Json<KnxDevice>, (StatusCode, Json<serde_json::Value>)> {
    let mut proj = state.project.write().await;

    let mut matched_ga_id = req.group_address_id;
    let mut matched_ga_addr = req.group_address.clone();

    if let Some(id) = matched_ga_id {
        if let Some(ga) = proj.group_addresses.iter().find(|g| g.id == id) {
            matched_ga_addr = Some(ga.address.clone());
        }
    } else if let Some(ref addr) = matched_ga_addr {
        if let Some(ga) = proj.group_addresses.iter().find(|g| &g.address == addr) {
            matched_ga_id = Some(ga.id);
        }
    }

    let device = proj
        .devices
        .iter_mut()
        .find(|d| d.id == device_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": format!("Gerät '{}' nicht gefunden", device_id) })),
            )
        })?;

    let ko = device
        .communication_objects
        .iter_mut()
        .find(|k| k.number == ko_number)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": format!("KO #{} nicht auf Gerät gefunden", ko_number) })),
            )
        })?;

    let unlink = req.unlink.unwrap_or(false);
    if unlink {
        if let Some(id) = matched_ga_id {
            ko.group_address_ids.retain(|x| *x != id);
        }
        if let Some(ref addr) = matched_ga_addr {
            ko.group_addresses.retain(|a| a != addr);
        }
    } else {
        if let Some(id) = matched_ga_id {
            if !ko.group_address_ids.contains(&id) {
                ko.group_address_ids.push(id);
            }
        }
        if let Some(ref addr) = matched_ga_addr {
            if !ko.group_addresses.contains(addr) {
                ko.group_addresses.push(addr.clone());
            }
        }
    }

    let res_dev = device.clone();
    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    Ok(Json(res_dev))
}

async fn handle_device_update_parameters(
    State(state): State<AppState>,
    axum::extract::Path(device_id): axum::extract::Path<Uuid>,
    Json(req): Json<UpdateParametersRequest>,
) -> Result<Json<KnxDevice>, (StatusCode, Json<serde_json::Value>)> {
    let mut proj = state.project.write().await;
    let device = proj
        .devices
        .iter_mut()
        .find(|d| d.id == device_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": format!("Gerät '{}' nicht gefunden", device_id) })),
            )
        })?;

    for update in req.parameters {
        if let Some(param) = device
            .parameters
            .iter_mut()
            .find(|p| p.id == update.id || p.name == update.id)
        {
            param.value = update.value;
        }
    }

    crate::programming::synchronize_dependent_parameters(&mut device.parameters);

    let res_dev = device.clone();
    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    Ok(Json(res_dev))
}

#[derive(Debug, serde::Deserialize)]
pub struct DevicePositionRequest {
    pub position: Option<Position>,
    pub room_id: Option<Uuid>,
    pub visible_ko_numbers: Option<Vec<u32>>,
}

async fn handle_device_position(
    State(state): State<AppState>,
    axum::extract::Path(device_id): axum::extract::Path<Uuid>,
    Json(req): Json<DevicePositionRequest>,
) -> Result<Json<KnxDevice>, (StatusCode, Json<serde_json::Value>)> {
    let mut proj = state.project.write().await;
    let device = proj
        .devices
        .iter_mut()
        .find(|d| d.id == device_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": format!("Gerät '{}' nicht gefunden", device_id) })),
            )
        })?;

    if req.position.is_some() || req.position.is_none() && req.visible_ko_numbers.is_none() && req.room_id.is_none() {
        device.position = req.position;
    }
    if let Some(rid) = req.room_id {
        device.room_id = Some(rid);
    }
    if let Some(kos) = req.visible_ko_numbers {
        device.visible_ko_numbers = kos;
    }

    let res_dev = device.clone();
    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    Ok(Json(res_dev))
}

#[derive(Debug, serde::Deserialize)]
pub struct ConnectPinsRequest {
    pub from_node_id: Uuid,
    pub from_pin: String,
    pub to_node_id: Uuid,
    pub to_pin: String,
    pub connection_id: Option<Uuid>,
}

#[derive(Debug, serde::Serialize)]
pub struct ConnectPinsResponse {
    pub success: bool,
    pub connection: WireConnection,
    pub group_address: Option<GroupAddress>,
    pub project: Project,
}

#[derive(Debug, serde::Deserialize)]
pub struct DisconnectPinsRequest {
    pub connection_id: Uuid,
}

async fn handle_wiring_connect(
    State(state): State<AppState>,
    Json(req): Json<ConnectPinsRequest>,
) -> Json<ConnectPinsResponse> {
    let mut proj = state.project.write().await;
    let (conn, ga) = AutoGaRouter::connect_endpoints(
        &mut proj,
        req.from_node_id,
        &req.from_pin,
        req.to_node_id,
        &req.to_pin,
        req.connection_id,
    );
    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    Json(ConnectPinsResponse {
        success: true,
        connection: conn,
        group_address: ga,
        project: cloned,
    })
}

async fn handle_wiring_disconnect(
    State(state): State<AppState>,
    Json(req): Json<DisconnectPinsRequest>,
) -> Json<serde_json::Value> {
    let mut proj = state.project.write().await;
    proj.connections.retain(|c| c.id != req.connection_id);
    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    Json(serde_json::json!({
        "success": true,
        "project": cloned
    }))
}

// ----------------------------------------------------------------------------
// Topology Management Handlers
// ----------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
pub struct AddAreaRequest {
    pub area_number: u8,
    pub name: String,
    pub medium: KnxMediumType,
}

#[derive(Debug, serde::Deserialize)]
pub struct AddLineRequest {
    pub area_id: Uuid,
    pub line_number: u8,
    pub name: String,
    pub medium: KnxMediumType,
    #[serde(default)]
    pub coupler_filter_mode: Option<LineCouplerFilterMode>,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateLineRequest {
    pub name: Option<String>,
    pub medium: Option<KnxMediumType>,
    pub coupler_filter_mode: Option<LineCouplerFilterMode>,
    pub manual_forward_gas: Option<Vec<String>>,
    pub coupler_device_id: Option<Option<Uuid>>,
    pub description: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct MoveDeviceRequest {
    pub device_id: Uuid,
    pub target_line_address: String,
}

async fn handle_get_topology(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mut proj = state.project.write().await;
    TopologyManager::ensure_topology(&mut proj);
    let issues = TopologyManager::validate_topology(&proj);
    Json(serde_json::json!({
        "topology": proj.topology,
        "issues": issues,
        "devices": proj.devices,
        "group_addresses": proj.group_addresses,
    }))
}

async fn handle_add_area(
    State(state): State<AppState>,
    Json(req): Json<AddAreaRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut proj = state.project.write().await;
    TopologyManager::ensure_topology(&mut proj);
    let topo = proj.topology.as_mut().unwrap();

    if topo.areas.iter().any(|a| a.area_number == req.area_number) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": format!("Bereich {} existiert bereits.", req.area_number) })),
        );
    }

    let area_id = Uuid::new_v4();
    let new_area = TopologyArea {
        id: area_id,
        area_number: req.area_number,
        address: req.area_number.to_string(),
        name: req.name,
        medium: req.medium,
        lines: Vec::new(),
    };
    topo.areas.push(new_area);
    topo.areas.sort_by_key(|a| a.area_number);
    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    (StatusCode::CREATED, Json(serde_json::json!({ "topology": cloned.topology })))
}

async fn handle_add_line(
    State(state): State<AppState>,
    Json(req): Json<AddLineRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut proj = state.project.write().await;
    TopologyManager::ensure_topology(&mut proj);
    let topo = proj.topology.as_mut().unwrap();

    let area = match topo.areas.iter_mut().find(|a| a.id == req.area_id) {
        Some(a) => a,
        None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Bereich nicht gefunden" }))),
    };

    if area.lines.iter().any(|l| l.line_number == req.line_number) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": format!("Linie {}.{} existiert bereits.", area.area_number, req.line_number) })),
        );
    }

    let line_addr = format!("{}.{}", area.area_number, req.line_number);
    let line_id = Uuid::new_v4();
    let new_line = TopologyLine {
        id: line_id,
        area_id: area.id,
        line_number: req.line_number,
        address: line_addr.clone(),
        name: req.name,
        medium: req.medium,
        coupler_device_id: None,
        coupler_filter_mode: req.coupler_filter_mode.unwrap_or(LineCouplerFilterMode::Filter),
        manual_forward_gas: Vec::new(),
        description: format!("KNX Linie {}", line_addr),
    };
    area.lines.push(new_line);
    area.lines.sort_by_key(|l| l.line_number);
    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    (StatusCode::CREATED, Json(serde_json::json!({ "topology": cloned.topology })))
}

async fn handle_update_line(
    AxPath(line_id): AxPath<Uuid>,
    State(state): State<AppState>,
    Json(req): Json<UpdateLineRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut proj = state.project.write().await;
    TopologyManager::ensure_topology(&mut proj);
    let topo = proj.topology.as_mut().unwrap();

    let mut found = false;
    for area in &mut topo.areas {
        for line in &mut area.lines {
            if line.id == line_id {
                if let Some(ref name) = req.name { line.name = name.clone(); }
                if let Some(medium) = req.medium { line.medium = medium; }
                if let Some(mode) = req.coupler_filter_mode { line.coupler_filter_mode = mode; }
                if let Some(ref gas) = req.manual_forward_gas { line.manual_forward_gas = gas.clone(); }
                if let Some(coupler_opt) = req.coupler_device_id { line.coupler_device_id = coupler_opt; }
                if let Some(ref desc) = req.description { line.description = desc.clone(); }
                found = true;
                break;
            }
        }
        if found { break; }
    }

    if found {
        let cloned = proj.clone();
        drop(proj);
        auto_save_if_enabled(&state, &cloned).await;
        (StatusCode::OK, Json(serde_json::json!({ "topology": cloned.topology })))
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Linie nicht gefunden" })))
    }
}

async fn handle_delete_line(
    AxPath(line_id): AxPath<Uuid>,
    State(state): State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut proj = state.project.write().await;
    TopologyManager::ensure_topology(&mut proj);

    let mut line_addr_opt = None;
    if let Some(topo) = &proj.topology {
        for area in &topo.areas {
            for line in &area.lines {
                if line.id == line_id {
                    line_addr_opt = Some(line.address.clone());
                    break;
                }
            }
        }
    }

    let line_addr = match line_addr_opt {
        Some(addr) => addr,
        None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Linie nicht gefunden" }))),
    };

    let prefix = format!("{}.", line_addr);
    let dev_count = proj.devices.iter().filter(|d| d.individual_address.starts_with(&prefix)).count();
    if dev_count > 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": format!("Linie {} kann nicht gelöscht werden: Es sind noch {} Gerät(e) zugewiesen.", line_addr, dev_count)
            })),
        );
    }

    let topo = proj.topology.as_mut().unwrap();
    for area in &mut topo.areas {
        area.lines.retain(|l| l.id != line_id);
    }
    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    (StatusCode::OK, Json(serde_json::json!({ "topology": cloned.topology })))
}

async fn handle_get_filter_table(
    AxPath(line_id): AxPath<Uuid>,
    State(state): State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut proj = state.project.write().await;
    TopologyManager::ensure_topology(&mut proj);
    match TopologyManager::calculate_filter_table(&proj, line_id) {
        Ok(summary) => (StatusCode::OK, Json(serde_json::json!(summary))),
        Err(err) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": err }))),
    }
}

async fn handle_move_device(
    State(state): State<AppState>,
    Json(req): Json<MoveDeviceRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut proj = state.project.write().await;
    TopologyManager::ensure_topology(&mut proj);
    match TopologyManager::move_device_to_line(&mut proj, req.device_id, &req.target_line_address) {
        Ok(new_address) => {
            let cloned = proj.clone();
            drop(proj);
            auto_save_if_enabled(&state, &cloned).await;
            (StatusCode::OK, Json(serde_json::json!({
                "success": true,
                "new_address": new_address,
                "project": cloned
            })))
        }
        Err(err) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": err }))),
    }
}

async fn handle_validate_topology(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mut proj = state.project.write().await;
    TopologyManager::ensure_topology(&mut proj);
    let issues = TopologyManager::validate_topology(&proj);
    Json(serde_json::json!({ "issues": issues }))
}

// ----------------------------------------------------------------------------
// Programming Engine & KNX Data Secure Handlers
// ----------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
pub struct CreateJobRequest {
    pub device_id: Uuid,
    pub job_type: ProgrammingJobType,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateDeviceSecurityRequest {
    pub is_secure_enabled: bool,
    #[serde(default)]
    pub serial_number: Option<String>,
    pub fdsk: Option<String>,
    #[serde(default)]
    pub generate_new_tool_key: bool,
}

async fn handle_get_programming_jobs(
    State(state): State<AppState>,
) -> Json<Vec<ProgrammingJob>> {
    Json(state.programming.get_jobs().await)
}

async fn handle_create_programming_job(
    State(state): State<AppState>,
    Json(req): Json<CreateJobRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    match state.programming.enqueue_job(req.device_id, req.job_type).await {
        Ok(job) => (StatusCode::CREATED, Json(serde_json::json!(job))),
        Err(err) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": err }))),
    }
}

async fn handle_flash_filter_table(
    AxPath(line_id): AxPath<Uuid>,
    State(state): State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    match state.programming.enqueue_filter_table_job(line_id).await {
        Ok(job) => (StatusCode::CREATED, Json(serde_json::json!(job))),
        Err(err) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": err }))),
    }
}

async fn handle_cancel_programming_job(
    AxPath(job_id): AxPath<Uuid>,
    State(state): State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    match state.programming.cancel_job(job_id).await {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(err) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": err }))),
    }
}

async fn handle_device_dirty_state(
    AxPath(device_id): AxPath<Uuid>,
    State(state): State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    let proj = state.project.read().await;
    let dev = match proj.devices.iter().find(|d| d.id == device_id) {
        Some(d) => d,
        None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Gerät nicht gefunden" }))),
    };

    let details = ProgrammingJobManager::get_device_dirty_details(dev);
    let last_flashed = dev.last_flashed_state.as_ref().map(|s| s.flashed_at);

    (StatusCode::OK, Json(serde_json::json!({
        "device_id": device_id,
        "is_dirty": details.is_dirty,
        "reasons": details.reasons,
        "parameter_diffs": details.parameter_diffs,
        "address_changed": details.address_changed,
        "added_gas": details.added_gas,
        "removed_gas": details.removed_gas,
        "added_associations": details.added_associations,
        "removed_associations": details.removed_associations,
        "is_initial": details.is_initial,
        "last_flashed": last_flashed,
        "is_secure": dev.security.as_ref().map(|s| s.is_secure_enabled).unwrap_or(false),
    })))
}

async fn handle_read_device_live_state(
    AxPath(device_id): AxPath<Uuid>,
    State(state): State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    match state.programming.read_device_live_state(device_id).await {
        Ok(res) => (StatusCode::OK, Json(serde_json::to_value(res).unwrap())),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))),
    }
}

async fn handle_mark_device_synced(
    AxPath(device_id): AxPath<Uuid>,
    State(state): State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut proj = state.project.write().await;
    let dev = match proj.devices.iter_mut().find(|d| d.id == device_id) {
        Some(d) => d,
        None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Gerät nicht gefunden" }))),
    };

    let gas: Vec<String> = dev.communication_objects.iter().flat_map(|k| k.group_addresses.iter().cloned()).collect();
    let assocs: Vec<(u32, String)> = dev.communication_objects.iter().flat_map(|k| k.group_addresses.iter().map(move |ga| (k.number, ga.clone()))).collect();
    let params: HashMap<String, String> = dev.parameters.iter().map(|p| (p.id.clone(), p.value.clone())).collect();

    let snap = DeviceFlashedSnapshot {
        individual_address: dev.individual_address.clone(),
        group_addresses: gas,
        associations: assocs,
        parameters: params,
        flashed_at: Utc::now(),
    };
    dev.last_flashed_state = Some(snap);

    let details = ProgrammingJobManager::get_device_dirty_details(dev);
    let last_flashed = dev.last_flashed_state.as_ref().map(|s| s.flashed_at);

    (StatusCode::OK, Json(serde_json::json!({
        "device_id": device_id,
        "is_dirty": details.is_dirty,
        "reasons": details.reasons,
        "parameter_diffs": details.parameter_diffs,
        "address_changed": details.address_changed,
        "added_gas": details.added_gas,
        "removed_gas": details.removed_gas,
        "added_associations": details.added_associations,
        "removed_associations": details.removed_associations,
        "is_initial": details.is_initial,
        "last_flashed": last_flashed,
        "is_secure": dev.security.as_ref().map(|s| s.is_secure_enabled).unwrap_or(false),
    })))
}

async fn handle_device_security(
    AxPath(device_id): AxPath<Uuid>,
    State(state): State<AppState>,
    Json(req): Json<UpdateDeviceSecurityRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut proj = state.project.write().await;
    let dev = match proj.devices.iter_mut().find(|d| d.id == device_id) {
        Some(d) => d,
        None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Gerät nicht gefunden" }))),
    };

    let mut current_sec = dev.security.clone().unwrap_or_else(|| KnxDataSecureConfig {
        is_secure_enabled: false,
        serial_number: None,
        fdsk: None,
        tool_key: None,
        sequence_number: 1,
    });

    current_sec.is_secure_enabled = req.is_secure_enabled;
    if req.serial_number.is_some() {
        current_sec.serial_number = req.serial_number;
    }

    if let Some(fdsk_str) = req.fdsk {
        if !fdsk_str.trim().is_empty() {
            match crate::data_secure::parse_fdsk(&fdsk_str) {
                Ok(_) => {
                    current_sec.fdsk = Some(fdsk_str);
                }
                Err(e) => {
                    return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": format!("Ungültiger FDSK: {}", e) })));
                }
            }
        }
    }

    if req.generate_new_tool_key || current_sec.tool_key.is_none() {
        current_sec.tool_key = Some(crate::data_secure::generate_tool_key());
    }

    dev.security = Some(current_sec.clone());

    let cloned = proj.clone();
    drop(proj);
    auto_save_if_enabled(&state, &cloned).await;

    (StatusCode::OK, Json(serde_json::json!({
        "success": true,
        "security": current_sec,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_version_endpoint() {
        let res = handle_get_version().await;
        assert_eq!(res.0.version, "2026.9.1");
        assert_eq!(res.0.name, "knx-core");
    }
}
