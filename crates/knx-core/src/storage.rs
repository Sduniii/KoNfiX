use crate::model::Project;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tracing::{error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageSettings {
    pub data_dir: String,
    pub active_project_name: Option<String>,
    #[serde(default = "default_true")]
    pub auto_save: bool,
    #[serde(default)]
    pub signing_key: Option<String>,
}

fn default_true() -> bool {
    true
}

impl Default for StorageSettings {
    fn default() -> Self {
        Self {
            data_dir: default_data_dir().to_string_lossy().to_string(),
            active_project_name: None,
            auto_save: true,
            signing_key: None,
        }
    }
}

/// Computes the default data directory path (`$KONFIX_DATA_DIR` or `~/.konfix`)
pub fn default_data_dir() -> PathBuf {
    if let Ok(env_dir) = std::env::var("KONFIX_DATA_DIR") {
        if !env_dir.trim().is_empty() {
            return PathBuf::from(env_dir.trim());
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(format!("{}/.konfix", home))
    } else {
        PathBuf::from("./.konfix")
    }
}

/// Sanitizes a user-supplied project or view name, preventing path traversal attacks,
/// null bytes, control characters, and limiting length.
pub fn sanitize_project_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Name darf nicht leer sein".to_string());
    }
    // Disallow path traversal components and path separators
    if trimmed == "." || trimmed == ".." || trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Ungültiger Name: Pfadtraversierung und Pfadtrennzeichen sind nicht erlaubt".to_string());
    }
    // Disallow null bytes and control characters
    if trimmed.chars().any(|c| c.is_control() || c == '\0') {
        return Err("Ungültiger Name: Steuerzeichen sind nicht erlaubt".to_string());
    }

    let mut safe = String::with_capacity(trimmed.len());
    for c in trimmed.chars() {
        if c.is_alphanumeric() || c == '_' || c == '-' {
            safe.push(c);
        } else {
            safe.push('_');
        }
    }

    // Collapse multiple consecutive underscores
    let mut collapsed = String::with_capacity(safe.len());
    let mut last_was_underscore = false;
    for c in safe.chars() {
        if c == '_' {
            if !last_was_underscore {
                collapsed.push(c);
                last_was_underscore = true;
            }
        } else {
            collapsed.push(c);
            last_was_underscore = false;
        }
    }

    let cleaned = collapsed.trim_matches('_');
    if cleaned.is_empty() {
        return Err("Name enthält keine gültigen alphanumerischen Zeichen".to_string());
    }

    let mut result = cleaned.to_string();
    if result.len() > 100 {
        result.truncate(100);
    }
    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMetadata {
    pub name: String,
    pub filename: String,
    pub path: String,
    pub modified_at: String,
    pub size_bytes: u64,
    pub ga_count: usize,
    pub device_count: usize,
    pub block_count: usize,
    pub room_count: usize,
}

#[derive(Clone)]
pub struct StorageManager {
    settings: Arc<RwLock<StorageSettings>>,
}

impl Default for StorageManager {
    fn default() -> Self {
        Self::new()
    }
}

impl StorageManager {
    /// Initializes StorageManager, reads settings.json if exists or creates defaults
    pub fn new() -> Self {
        let base_dir = default_data_dir();
        let settings_file = base_dir.join("settings.json");

        let mut settings = if settings_file.exists() {
            match fs::read_to_string(&settings_file) {
                Ok(content) => match serde_json::from_str::<StorageSettings>(&content) {
                    Ok(s) => s,
                    Err(e) => {
                        warn!("Could not parse settings.json: {}. Using defaults.", e);
                        StorageSettings::default()
                    }
                },
                Err(e) => {
                    warn!("Could not read settings.json: {}. Using defaults.", e);
                    StorageSettings::default()
                }
            }
        } else {
            StorageSettings::default()
        };

        // Ensure settings.data_dir is populated
        if settings.data_dir.trim().is_empty() {
            settings.data_dir = base_dir.to_string_lossy().to_string();
        }

        // Check environment variable for signing key if not present in settings
        if settings.signing_key.is_none() {
            if let Ok(env_key) = std::env::var("KONFIX_SIGNING_KEY") {
                let trimmed = env_key.trim();
                if !trimmed.is_empty() {
                    settings.signing_key = Some(trimmed.to_string());
                }
            } else if let Ok(key_path) = std::env::var("KONFIX_SIGNING_KEY_PATH") {
                if let Ok(content) = fs::read_to_string(key_path.trim()) {
                    let trimmed = content.trim();
                    if !trimmed.is_empty() {
                        settings.signing_key = Some(trimmed.to_string());
                    }
                }
            }
        }

        let mgr = Self {
            settings: Arc::new(RwLock::new(settings)),
        };

        // Ensure directories exist
        if let Err(e) = mgr.ensure_dirs_sync() {
            error!("Failed to create Konfix storage directories: {}", e);
        }

        mgr
    }

    /// Synchronously ensures data directories exist
    pub fn ensure_dirs_sync(&self) -> Result<(), String> {
        let data_dir = {
            let s = self.settings.read().unwrap();
            PathBuf::from(&s.data_dir)
        };

        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(data_dir.join("projects")).map_err(|e| e.to_string())?;
        fs::create_dir_all(data_dir.join("views")).map_err(|e| e.to_string())?;
        fs::create_dir_all(data_dir.join("backups")).map_err(|e| e.to_string())?;
        fs::create_dir_all(data_dir.join("catalog")).map_err(|e| e.to_string())?;

        // Save current settings.json if not present
        let settings_file = data_dir.join("settings.json");
        if !settings_file.exists() {
            let s = self.settings.read().unwrap();
            if let Ok(json) = serde_json::to_string_pretty(&*s) {
                let _ = fs::write(&settings_file, json);
            }
        }

        Ok(())
    }

    /// Synchronously gets current storage settings
    pub fn get_settings_sync(&self) -> StorageSettings {
        self.settings.read().unwrap().clone()
    }

    /// Asynchronously gets current storage settings
    pub async fn get_settings(&self) -> StorageSettings {
        self.settings.read().unwrap().clone()
    }

    /// Persists settings to settings.json with restrictive permissions
    pub async fn persist_settings(&self) -> Result<(), String> {
        let s = self.settings.read().unwrap().clone();
        let data_dir = PathBuf::from(&s.data_dir);
        let settings_file = data_dir.join("settings.json");
        let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
        fs::write(&settings_file, json).map_err(|e| e.to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = fs::metadata(&settings_file) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o600);
                let _ = fs::set_permissions(&settings_file, perms);
            }
        }

        Ok(())
    }

    /// Updates data directory and optionally migrates projects
    pub async fn update_data_dir(&self, new_dir: &str, migrate: bool) -> Result<StorageSettings, String> {
        let trimmed = new_dir.trim();
        if trimmed.is_empty() {
            return Err("Verzeichnispfad darf nicht leer sein".to_string());
        }

        let new_path = PathBuf::from(trimmed);

        // Security check: Block critical operating system root directories
        let forbidden_roots = [
            "/", "/etc", "/bin", "/sbin", "/usr", "/var", "/boot", "/sys", "/proc", "/dev", "/root",
            "C:\\", "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)",
        ];
        let normalized = new_path.to_string_lossy().to_string();
        for forbidden in &forbidden_roots {
            if normalized == *forbidden || (normalized.starts_with(&format!("{}/", forbidden)) && *forbidden != "/") {
                return Err(format!("Verzeichnis '{}' ist ein geschütztes Systemverzeichnis und kann nicht als KoNfiX-Speicherort verwendet werden", trimmed));
            }
        }
        if normalized == "/" {
            return Err("Wurzelverzeichnis '/' kann nicht als KoNfiX-Speicherort verwendet werden".to_string());
        }

        fs::create_dir_all(&new_path).map_err(|e| format!("Kann Verzeichnis nicht erstellen: {}", e))?;
        fs::create_dir_all(new_path.join("projects")).map_err(|e| e.to_string())?;
        fs::create_dir_all(new_path.join("views")).map_err(|e| e.to_string())?;
        fs::create_dir_all(new_path.join("backups")).map_err(|e| e.to_string())?;
        fs::create_dir_all(new_path.join("catalog")).map_err(|e| e.to_string())?;

        let old_dir = {
            let s = self.settings.read().unwrap();
            PathBuf::from(&s.data_dir)
        };

        if migrate && old_dir.exists() && old_dir != new_path {
            // Copy projects
            let old_projects = old_dir.join("projects");
            if old_projects.exists() {
                if let Ok(entries) = fs::read_dir(old_projects) {
                    for entry in entries.flatten() {
                        let target = new_path.join("projects").join(entry.file_name());
                        let _ = fs::copy(entry.path(), target);
                    }
                }
            }
            // Copy views
            let old_views = old_dir.join("views");
            if old_views.exists() {
                if let Ok(entries) = fs::read_dir(old_views) {
                    for entry in entries.flatten() {
                        let target = new_path.join("views").join(entry.file_name());
                        let _ = fs::copy(entry.path(), target);
                    }
                }
            }
        }

        {
            let mut s = self.settings.write().unwrap();
            s.data_dir = new_path.to_string_lossy().to_string();
        }

        self.persist_settings().await?;

        Ok(self.get_settings().await)
    }

    /// Updates signing key in settings and persists to disk
    pub async fn update_signing_key(&self, key: Option<String>) -> Result<StorageSettings, String> {
        let clean = key.and_then(|k| {
            let t = k.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        });
        {
            let mut s = self.settings.write().unwrap();
            s.signing_key = clean;
        }
        self.persist_settings().await?;
        Ok(self.get_settings().await)
    }

    /// Updates both data directory and signing key if provided
    pub async fn update_storage_settings(
        &self,
        new_dir: Option<&str>,
        migrate: bool,
        signing_key: Option<Option<String>>,
    ) -> Result<StorageSettings, String> {
        if let Some(dir) = new_dir {
            if !dir.trim().is_empty() {
                self.update_data_dir(dir, migrate).await?;
            }
        }
        if let Some(key_opt) = signing_key {
            self.update_signing_key(key_opt).await?;
        }
        Ok(self.get_settings().await)
    }

    /// Lists all `.konfix` (and `.json`) projects in `<data_dir>/projects`
    pub async fn list_projects(&self) -> Result<Vec<ProjectMetadata>, String> {
        let data_dir = {
            let s = self.settings.read().unwrap();
            PathBuf::from(&s.data_dir)
        };
        let projects_dir = data_dir.join("projects");
        if !projects_dir.exists() {
            return Ok(Vec::new());
        }

        let mut list = Vec::new();
        let entries = fs::read_dir(projects_dir).map_err(|e| e.to_string())?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                if ext == "konfix" || ext == "json" {
                    let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();

                    let metadata = entry.metadata().ok();
                    let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let modified_at = metadata
                        .and_then(|m| m.modified().ok())
                        .map(|t| {
                            let dt: DateTime<Utc> = t.into();
                            dt.to_rfc3339()
                        })
                        .unwrap_or_else(|| Utc::now().to_rfc3339());

                    // Quick read to extract counts
                    let (ga_count, device_count, block_count, room_count) = match fs::read_to_string(&path) {
                        Ok(content) => match serde_json::from_str::<Project>(&content) {
                            Ok(p) => (
                                p.group_addresses.len(),
                                p.devices.len(),
                                p.blocks.len(),
                                p.rooms.len(),
                            ),
                            Err(_) => (0, 0, 0, 0),
                        },
                        Err(_) => (0, 0, 0, 0),
                    };

                    list.push(ProjectMetadata {
                        name,
                        filename,
                        path: path.to_string_lossy().to_string(),
                        modified_at,
                        size_bytes,
                        ga_count,
                        device_count,
                        block_count,
                        room_count,
                    });
                }
            }
        }

        // Sort latest modified first
        list.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

        Ok(list)
    }

    /// Saves the project to `<data_dir>/projects/<name>.konfix`
    pub async fn save_project(&self, project: &Project, custom_name: Option<&str>) -> Result<ProjectMetadata, String> {
        let data_dir = {
            let s = self.settings.read().unwrap();
            PathBuf::from(&s.data_dir)
        };
        let projects_dir = data_dir.join("projects");
        let backups_dir = data_dir.join("backups");
        fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;

        let raw_name = custom_name.unwrap_or(&project.name).trim();
        let name = sanitize_project_name(raw_name).unwrap_or_else(|_| "default".to_string());

        let file_path = projects_dir.join(format!("{}.konfix", name));

        // Create backup if previous file existed
        if file_path.exists() {
            let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
            let backup_path = backups_dir.join(format!("{}_{}.bak", name, timestamp));
            let _ = fs::copy(&file_path, backup_path);
        }

        // Serialize project
        let mut proj_to_save = project.clone();
        if let Some(cn) = custom_name {
            proj_to_save.name = cn.to_string();
        }

        let json = serde_json::to_string_pretty(&proj_to_save).map_err(|e| e.to_string())?;
        fs::write(&file_path, json).map_err(|e| format!("Fehler beim Schreiben von {}: {}", file_path.display(), e))?;

        // Ensure target asset bundle exists if source project had assets
        let target_asset_path = projects_dir.join(format!("{}.assets.zip", name));
        if !target_asset_path.exists() {
            if let Some(source_assets) = self.load_project_assets_sync(&project.name) {
                let _ = fs::write(&target_asset_path, source_assets);
            }
        }

        // Update active project name
        {
            let mut s = self.settings.write().unwrap();
            s.active_project_name = Some(name.clone());
        }
        let _ = self.persist_settings().await;

        let meta = fs::metadata(&file_path).map_err(|e| e.to_string())?;
        let modified_at = meta
            .modified()
            .ok()
            .map(|t| {
                let dt: DateTime<Utc> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        info!("Saved project to {}", file_path.display());

        Ok(ProjectMetadata {
            name,
            filename: format!("{}.konfix", project.name),
            path: file_path.to_string_lossy().to_string(),
            modified_at,
            size_bytes: meta.len(),
            ga_count: project.group_addresses.len(),
            device_count: project.devices.len(),
            block_count: project.blocks.len(),
            room_count: project.rooms.len(),
        })
    }

    /// Loads a project by name from `<data_dir>/projects/<name>.konfix`
    pub async fn load_project(&self, name: &str) -> Result<Project, String> {
        let data_dir = {
            let s = self.settings.read().unwrap();
            PathBuf::from(&s.data_dir)
        };
        let projects_dir = data_dir.join("projects");

        let safe_name = sanitize_project_name(name)?;
        let konfix_path = projects_dir.join(format!("{}.konfix", safe_name));
        let json_path = projects_dir.join(format!("{}.json", safe_name));

        let file_path = if konfix_path.exists() {
            konfix_path
        } else if json_path.exists() {
            json_path
        } else {
            return Err(format!("Projekt '{}' wurde nicht in {} gefunden", name, projects_dir.display()));
        };

        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Fehler beim Lesen der Datei {}: {}", file_path.display(), e))?;

        let mut project: Project = serde_json::from_str(&content)
            .map_err(|e| format!("Fehler beim Parsen der Projektdatei {}: {}", file_path.display(), e))?;

        // Check if any device has missing parameter offsets, missing loaded_image, missing serial number, missing assign_rules, or missing product_ref_id
        let needs_enrichment = project.devices.iter().any(|d| {
            d.parameters.iter().any(|p| p.offset.is_none())
                || (d.loaded_image.is_none() && !d.parameters.is_empty())
                || d.get_serial_number().is_none()
                || (d.assign_rules.is_empty() && !d.parameters.is_empty())
                || d.product_ref_id.is_none()
        });

        if needs_enrichment {
            let mut knxproj_candidates: Vec<PathBuf> = Vec::new();
            if let Ok(path) = std::env::var("KONFIX_PROJECT_PATH") {
                knxproj_candidates.push(PathBuf::from(path));
            }
            knxproj_candidates.push(data_dir.join("project.knxproj"));
            knxproj_candidates.push(PathBuf::from("project.knxproj"));

            // Check any .knxproj in data_dir
            if let Ok(entries) = std::fs::read_dir(&data_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension().is_some_and(|ext| ext == "knxproj") {
                        knxproj_candidates.push(p);
                    }
                }
            }

            let project_pass = std::env::var("KONFIX_PROJECT_PASSWORD").ok();

            for cand in knxproj_candidates {
                if let Ok(bytes) = std::fs::read(&cand) {
                    if let Ok(count) = crate::ets_import::enrich_project_from_knxproj(&mut project, &bytes, project_pass.as_deref()) {
                        if count > 0 {
                            info!("Auto-enriched project '{}' (offsets, images, serial numbers, assign rules: {} updates) from {}", project.name, count, cand.display());
                            // Auto-save the enriched project to persist offsets
                            let _ = self.save_project(&project, Some(&safe_name)).await;
                            break;
                        }
                    }
                }
            }
        }

        // Auto-resolve missing ProductRefId and Hardware2ProgramRefId from project assets
        if project.devices.iter().any(|d| d.product_ref_id.is_none() || d.hardware2program_ref_id.is_none()) {
            if let Some(assets_bytes) = self.load_project_assets_sync(&project.name) {
                let cat = crate::ets_export::HardwareCatalogIndex::from_assets(&assets_bytes);
                let mut updated_refs = 0;
                for dev in &mut project.devices {
                    if dev.product_ref_id.is_none() || dev.hardware2program_ref_id.is_none() {
                        let (p, h) = cat.resolve_device_refs(dev);
                        if dev.product_ref_id.is_none() && p.is_some() {
                            dev.product_ref_id = p;
                            updated_refs += 1;
                        }
                        if dev.hardware2program_ref_id.is_none() && h.is_some() {
                            dev.hardware2program_ref_id = h;
                            updated_refs += 1;
                        }
                    }
                }
                if updated_refs > 0 {
                    info!("Auto-resolved {} catalog product/hardware references for project '{}'", updated_refs, project.name);
                    let _ = self.save_project(&project, Some(&safe_name)).await;
                }
            }
        }

        // Auto-normalize and synchronize device parameters according to ETS assign rules & dependent parameters
        let mut params_synced = 0;
        for dev in &mut project.devices {
            params_synced += crate::programming::synchronize_device_parameters(dev);
        }
        if params_synced > 0 {
            info!("Auto-synchronized {} parameters across project devices for '{}'", params_synced, project.name);
            let _ = self.save_project(&project, Some(&safe_name)).await;
        }

        // Update active project
        {
            let mut s = self.settings.write().unwrap();
            s.active_project_name = Some(safe_name);
        }
        let _ = self.persist_settings().await;

        info!("Loaded project '{}' from {}", project.name, file_path.display());

        Ok(project)
    }

    /// Saves the raw asset archive (M-* manufacturer catalogs, signatures, knx_master.xml)
    /// to `<data_dir>/projects/<name>.assets.zip`
    pub fn save_project_assets_sync(&self, project_name: &str, assets_zip_bytes: &[u8]) -> Result<(), String> {
        let data_dir = {
            let s = self.settings.read().unwrap();
            PathBuf::from(&s.data_dir)
        };
        let projects_dir = data_dir.join("projects");
        let _ = fs::create_dir_all(&projects_dir);
        let safe_name = sanitize_project_name(project_name).unwrap_or_else(|_| "default".to_string());
        let path = projects_dir.join(format!("{}.assets.zip", safe_name));
        fs::write(&path, assets_zip_bytes)
            .map_err(|e| format!("Fehler beim Schreiben von Assets {}: {}", path.display(), e))?;
        Ok(())
    }

    /// Loads project asset archive if exists (with case-insensitive and normalized fallback)
    pub fn load_project_assets_sync(&self, project_name: &str) -> Option<Vec<u8>> {
        let data_dir = {
            let s = self.settings.read().unwrap();
            PathBuf::from(&s.data_dir)
        };
        let projects_dir = data_dir.join("projects");
        let safe_name = sanitize_project_name(project_name).ok()?;

        // 1. Direct match: <safe_name>.assets.zip
        let path = projects_dir.join(format!("{}.assets.zip", safe_name));
        if path.exists() {
            if let Ok(bytes) = fs::read(&path) {
                return Some(bytes);
            }
        }

        // 2. Lowercase match: <safe_name.to_lowercase()>.assets.zip
        let lower_path = projects_dir.join(format!("{}.assets.zip", safe_name.to_lowercase()));
        if lower_path.exists() {
            if let Ok(bytes) = fs::read(&lower_path) {
                return Some(bytes);
            }
        }

        // 3. Scan projects directory for case-insensitive match on *.assets.zip
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            let target_lower = format!("{}.assets.zip", safe_name.to_lowercase());
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.to_lowercase() == target_lower {
                    if let Ok(bytes) = fs::read(entry.path()) {
                        return Some(bytes);
                    }
                }
            }
        }

        // 4. Fallback: Search all available *.assets.zip files in projects directory
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            let mut candidates: Vec<PathBuf> = Vec::new();
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() && p.extension().map(|e| e == "zip").unwrap_or(false) {
                    let file_name = p.file_name().unwrap_or_default().to_string_lossy();
                    if file_name.ends_with(".assets.zip") {
                        candidates.push(p);
                    }
                }
            }

            // Sort candidates by size (prefer largest catalog bundle)
            candidates.sort_by(|a, b| {
                let a_size = a.metadata().map(|m| m.len()).unwrap_or(0);
                let b_size = b.metadata().map(|m| m.len()).unwrap_or(0);
                b_size.cmp(&a_size)
            });

            for candidate in candidates {
                if let Ok(bytes) = fs::read(&candidate) {
                    if bytes.len() > 100_000 {
                        tracing::info!("Verwende Fallback-Asset-Paket von '{}' für Projekt '{}'", candidate.display(), safe_name);
                        return Some(bytes);
                    }
                }
            }
        }

        None
    }

    pub async fn save_project_assets(&self, project_name: &str, assets_zip_bytes: &[u8]) -> Result<(), String> {
        self.save_project_assets_sync(project_name, assets_zip_bytes)
    }

    pub async fn load_project_assets(&self, project_name: &str) -> Option<Vec<u8>> {
        self.load_project_assets_sync(project_name)
    }

    /// Saves view state (active workspace, zoom, pan, active room)
    pub async fn save_view(&self, project_name: &str, view_data: serde_json::Value) -> Result<(), String> {
        let data_dir = {
            let s = self.settings.read().unwrap();
            PathBuf::from(&s.data_dir)
        };
        let views_dir = data_dir.join("views");
        fs::create_dir_all(&views_dir).map_err(|e| e.to_string())?;

        let safe_name = sanitize_project_name(project_name).unwrap_or_else(|_| "default".to_string());
        let view_path = views_dir.join(format!("{}.view.json", safe_name));

        let json = serde_json::to_string_pretty(&view_data).map_err(|e| e.to_string())?;
        fs::write(view_path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Loads view state for a project
    pub async fn load_view(&self, project_name: &str) -> Option<serde_json::Value> {
        let data_dir = {
            let s = self.settings.read().unwrap();
            PathBuf::from(&s.data_dir)
        };
        let views_dir = data_dir.join("views");
        let safe_name = sanitize_project_name(project_name).ok()?;
        let view_path = views_dir.join(format!("{}.view.json", safe_name));

        if view_path.exists() {
            if let Ok(content) = fs::read_to_string(&view_path) {
                return serde_json::from_str(&content).ok();
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample_data::create_demo_project;

    #[tokio::test]
    async fn test_storage_lifecycle_save_load_list() {
        let tmp_path = std::env::temp_dir().join(format!("konfix_test_{}", uuid::Uuid::new_v4()));
        let storage = StorageManager::new();
        let _ = storage.update_data_dir(&tmp_path.to_string_lossy(), false).await;

        let demo = create_demo_project();
        let meta = storage.save_project(&demo, Some("TestVilla")).await.expect("save project");
        assert_eq!(meta.name, "TestVilla");
        assert!(meta.ga_count > 0);

        // List
        let list = storage.list_projects().await.expect("list projects");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "TestVilla");

        // Load
        let loaded = storage.load_project("TestVilla").await.expect("load project");
        assert_eq!(loaded.name, "TestVilla");
        assert_eq!(loaded.group_addresses.len(), demo.group_addresses.len());

        // View
        let view_val = serde_json::json!({
            "active_workspace": "topology",
            "zoom": 1.25,
            "pan_x": 100.0,
            "pan_y": 200.0
        });
        storage.save_view("TestVilla", view_val.clone()).await.expect("save view");
        let loaded_view = storage.load_view("TestVilla").await.expect("load view");
        assert_eq!(loaded_view["active_workspace"], "topology");
        assert_eq!(loaded_view["zoom"], 1.25);
    }

    #[tokio::test]
    async fn test_auto_enrich_parameter_offsets_from_knxproj() {
        let knxproj_path = std::env::var("KONFIX_TEST_KNXPROJ").unwrap_or_else(|_| "test.knxproj".to_string());
        if !std::path::Path::new(&knxproj_path).exists() {
            return;
        }

        let tmp_path = std::env::temp_dir().join(format!("konfix_enrich_test_{}", uuid::Uuid::new_v4()));
        let storage = StorageManager::new();
        let _ = storage.update_data_dir(&tmp_path.to_string_lossy(), false).await;

        // Create a dummy device 1.1.11 without offsets
        let mut proj = create_demo_project();
        proj.name = "EnrichTest".to_string();
        proj.devices.push(crate::model::KnxDevice {
            id: uuid::Uuid::new_v4(),
            name: "Rolladensteuerung Fenster Links".to_string(),
            individual_address: "1.1.11".to_string(),
            application_program: Some("M-0083_A-00C6-41-59D6".to_string()),
            parameters: vec![
                crate::model::DeviceParameter {
                    id: "M-0083_A-00C6-41-59D6_P-27".to_string(),
                    name: "shutter_mudt_0".to_string(),
                    text: "Verfahrzeit".to_string(),
                    param_type: "number".to_string(),
                    value: "28".to_string(),
                    offset: None,
                    bit_offset: None,
                    size_in_bit: None,
                    ..Default::default()
                },
                crate::model::DeviceParameter {
                    id: "M-0083_A-00C6-41-59D6_P-28".to_string(),
                    name: "shutter_mdt_0".to_string(),
                    text: "Verfahrzeit Fahrtrichtung Ab".to_string(),
                    param_type: "number".to_string(),
                    value: "26".to_string(),
                    offset: None,
                    bit_offset: None,
                    size_in_bit: None,
                    ..Default::default()
                },
            ],
            loaded_image: None,
            ..Default::default()
        });

        // Save project with offset: None
        storage.save_project(&proj, Some("EnrichTest")).await.expect("save project");

        // Load project -> auto-enrich from knxproj archive if present
        let loaded = storage.load_project("EnrichTest").await.expect("load project");
        let dev11 = loaded.devices.iter().find(|d| d.individual_address == "1.1.11").expect("1.1.11 must exist");
        let mudt = dev11.parameters.iter().find(|p| p.name == "shutter_mudt_0").expect("mudt must exist");
        let mdt = dev11.parameters.iter().find(|p| p.name == "shutter_mdt_0").expect("mdt must exist");

        assert_eq!(mudt.offset, Some(4));
        assert_eq!(mudt.size_in_bit, Some(16));
        assert_eq!(mudt.value, "28"); // Preserved user value!

        assert_eq!(mdt.offset, Some(6));
        assert_eq!(mdt.size_in_bit, Some(16));
        assert_eq!(mdt.value, "28"); // Auto-synchronized to mudt because P-26 default is 0 (gleich)!

        assert!(dev11.loaded_image.is_some()); // LoadedImage auto-populated!
        assert_eq!(dev11.get_serial_number(), Some("00:83:76:8A:0C:65")); // SerialNumber auto-populated!
    }

    #[test]
    fn test_sanitize_project_name() {
        assert_eq!(sanitize_project_name("Villa Marienthal").unwrap(), "Villa_Marienthal");
        assert_eq!(sanitize_project_name("Mein-Projekt_2026").unwrap(), "Mein-Projekt_2026");
        assert_eq!(sanitize_project_name("Haus_äöü_EG").unwrap(), "Haus_äöü_EG");

        // Path traversal attempts must be rejected
        assert!(sanitize_project_name("..").is_err());
        assert!(sanitize_project_name("../evil").is_err());
        assert!(sanitize_project_name("../../etc/passwd").is_err());
        assert!(sanitize_project_name("sub/dir").is_err());
        assert!(sanitize_project_name("sub\\dir").is_err());
        assert!(sanitize_project_name("").is_err());
        assert!(sanitize_project_name("   ").is_err());
        assert!(sanitize_project_name("\0malicious").is_err());
    }

    #[tokio::test]
    async fn test_update_data_dir_blocks_system_roots() {
        let storage = StorageManager::new();
        assert!(storage.update_data_dir("/", false).await.is_err());
        assert!(storage.update_data_dir("/etc", false).await.is_err());
        assert!(storage.update_data_dir("/bin", false).await.is_err());
        assert!(storage.update_data_dir("/usr", false).await.is_err());
        assert!(storage.update_data_dir("", false).await.is_err());
    }

    #[tokio::test]
    async fn test_storage_settings_with_signing_key() {
        let temp_dir = std::env::temp_dir().join(format!("konfix_test_settings_{}", uuid::Uuid::new_v4()));
        let mut settings = StorageSettings::default();
        settings.data_dir = temp_dir.to_string_lossy().to_string();
        settings.signing_key = Some("TEST_SIGNING_KEY_12345".to_string());

        let mgr = StorageManager {
            settings: std::sync::Arc::new(std::sync::RwLock::new(settings)),
        };
        mgr.ensure_dirs_sync().expect("ensure dirs");
        mgr.persist_settings().await.expect("persist settings");

        // Verify loaded settings
        let loaded = mgr.get_settings().await;
        assert_eq!(loaded.signing_key.as_deref(), Some("TEST_SIGNING_KEY_12345"));

        // Update signing key
        let updated = mgr.update_signing_key(Some("NEW_KEY_ABC".to_string())).await.expect("update key");
        assert_eq!(updated.signing_key.as_deref(), Some("NEW_KEY_ABC"));

        // Clear signing key with empty string
        let cleared = mgr.update_signing_key(Some("   ".to_string())).await.expect("clear key");
        assert_eq!(cleared.signing_key, None);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let settings_file = temp_dir.join("settings.json");
            let mode = std::fs::metadata(&settings_file).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "settings.json must have 0600 permissions on Unix");
        }

        // Clean up
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}

