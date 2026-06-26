use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

// ── 配置 ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub vditor_options: Option<serde_json::Value>,
    pub recent_files: Vec<String>,
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
    pub welcome_dark: Option<bool>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            vditor_options: None,
            recent_files: Vec::new(),
            window_width: None,
            window_height: None,
            window_x: None,
            window_y: None,
            welcome_dark: None,
        }
    }
}

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .expect("failed to get config dir");
    config_dir.join("config.json")
}

fn load_config(app: &tauri::AppHandle) -> AppConfig {
    let path = config_path(app);
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        AppConfig::default()
    }
}

fn save_config_to_disk(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ── 状态管理 ────────────────────────────────────────────

struct AppState {
    current_file: Mutex<Option<String>>,
    is_dirty: Mutex<bool>,
    force_close: Mutex<bool>, // 前端确认后强制关闭
    last_file_mtime: Mutex<Option<SystemTime>>, // 外部修改检测
}

// ── Tauri Commands ───────────────────────────────────────

#[tauri::command]
fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<(String, String)>, String> {
    let window = app.get_webview_window("main").ok_or("无法获取主窗口")?;
    let file = window
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("All Files", &["*"])
        .set_title("打开 Markdown 文件")
        .blocking_pick_file();

    match file {
        Some(path) => {
            let path_str = path.to_string();
            let content = fs::read_to_string(&path_str).map_err(|e| e.to_string())?;

            let state = app.state::<AppState>();
            *state.current_file.lock().unwrap() = Some(path_str.clone());
            *state.is_dirty.lock().unwrap() = false;
            // 记录文件修改时间用于外部检测
            if let Ok(meta) = fs::metadata(&path_str) {
                if let Ok(mtime) = meta.modified() {
                    *state.last_file_mtime.lock().unwrap() = Some(mtime);
                }
            }

            // 添加到最近文件
            let mut config = load_config(&app);
            config.recent_files.retain(|f| f != &path_str);
            config.recent_files.insert(0, path_str.clone());
            if config.recent_files.len() > 10 {
                config.recent_files.truncate(10);
            }
            save_config_to_disk(&app, &config).ok();

            Ok(Some((path_str, content)))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    *state.current_file.lock().unwrap() = Some(path.clone());
    *state.is_dirty.lock().unwrap() = false;
    // 记录文件修改时间用于外部检测
    if let Ok(meta) = fs::metadata(&path) {
        if let Ok(mtime) = meta.modified() {
            *state.last_file_mtime.lock().unwrap() = Some(mtime);
        }
    }
    Ok(content)
}

#[tauri::command]
fn save_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    *state.is_dirty.lock().unwrap() = false;
    // 更新跟踪的 mtime，避免自我保存触发"外部修改"误报
    if let Ok(meta) = fs::metadata(&path) {
        if let Ok(mtime) = meta.modified() {
            *state.last_file_mtime.lock().unwrap() = Some(mtime);
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("saved", ());
    }
    Ok(())
}

#[tauri::command]
fn save_file_as(app: tauri::AppHandle, content: String) -> Result<Option<String>, String> {
    let window = app.get_webview_window("main").ok_or("无法获取主窗口")?;
    let file = window
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_title("另存为")
        .blocking_save_file();

    match file {
        Some(path) => {
            let path_str = path.to_string();
            fs::write(&path_str, &content).map_err(|e| e.to_string())?;
            let state = app.state::<AppState>();
            *state.current_file.lock().unwrap() = Some(path_str.clone());
            *state.is_dirty.lock().unwrap() = false;
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImageFile {
    pub base64: String,
    pub name: String,
}

#[tauri::command]
fn save_images(_app: tauri::AppHandle, dir: String, files: Vec<ImageFile>) -> Result<Vec<String>, String> {
    let dir_path = Path::new(&dir);
    fs::create_dir_all(dir_path).map_err(|e| format!("创建图片目录失败: {}", e))?;

    let mut saved_paths = Vec::new();
    for file in &files {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&file.base64)
            .map_err(|e| format!("Base64 解码失败: {}", e))?;
        let file_path = dir_path.join(&file.name);
        fs::write(&file_path, &bytes).map_err(|e| format!("写入图片失败: {}", e))?;
        saved_paths.push(file.name.clone());
    }
    Ok(saved_paths)
}

#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(&url, None::<&str>)
        .map_err(|e| format!("打开链接失败: {}", e))
}

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    Ok(load_config(&app))
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    save_config_to_disk(&app, &config)
}

#[tauri::command]
fn get_current_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let result = state.current_file.lock().unwrap().clone();
    Ok(result)
}

#[tauri::command]
fn set_dirty(app: tauri::AppHandle, dirty: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.is_dirty.lock().unwrap() = dirty;
    Ok(())
}

#[tauri::command]
fn is_dirty(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let result = *state.is_dirty.lock().unwrap();
    Ok(result)
}

#[tauri::command]
fn show_message(app: tauri::AppHandle, kind: String, message: String) -> Result<(), String> {
    use tauri_plugin_dialog::MessageDialogKind;
    let kind = match kind.as_str() {
        "error" => MessageDialogKind::Error,
        "warning" => MessageDialogKind::Warning,
        "info" => MessageDialogKind::Info,
        _ => MessageDialogKind::Info,
    };
    if let Some(w) = app.get_webview_window("main") {
        w.dialog()
            .message(&message)
            .kind(kind)
            .show(|_| {});
    }
    Ok(())
}

/// 前端确认关闭后调用（设置 force_close 标志并触发关闭）
#[tauri::command]
fn request_close(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.force_close.lock().unwrap() = true;
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── 外部文件修改检测 ──────────────────────────────────────

/// 检测文件是否被外部修改（对比上次记录的 mtime）
#[tauri::command]
fn check_file_changed(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let mtime = meta.modified().map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    let mut last_mtime = state.last_file_mtime.lock().unwrap();
    match *last_mtime {
        Some(prev) => {
            if mtime != prev {
                *last_mtime = Some(mtime); // 更新记录，下次不再重复提示
                return Ok(true);
            }
            Ok(false)
        }
        None => {
            // 首次检查，记录 mtime
            *last_mtime = Some(mtime);
            Ok(false)
        }
    }
}

// ── 应用入口 ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK 在 Wayland 上 GPU 合成有问题 → 白屏。
    // 走 CPU 合成解决，不影响 Windows/macOS。
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            current_file: Mutex::new(None),
            is_dirty: Mutex::new(false),
            force_close: Mutex::new(false),
            last_file_mtime: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            open_file_dialog,
            read_file,
            save_file,
            save_file_as,
            save_images,
            open_link,
            get_config,
            save_config,
            get_current_file,
            set_dirty,
            is_dirty,
            show_message,
            request_close,
            check_file_changed,
        ])
        .setup(|app| {
            // ── 命令行参数：读取首个非 flag 参数作为文件路径 ──
            {
                let args: Vec<String> = std::env::args().collect();
                let file_arg = args.iter().skip(1).find(|a| {
                    !a.starts_with('-') && !a.starts_with("http")
                });
                if let Some(path) = file_arg {
                    if std::path::Path::new(path).exists() {
                        let state = app.state::<AppState>();
                        *state.current_file.lock().unwrap() = Some(path.clone());
                    }
                }
            }

            // ── 拦截关闭请求 + 拖拽打开文件 ──
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            let state = w.state::<AppState>();

                            // 同一锁作用域内读+复位，避免重入竞态
                            let mut force = state.force_close.lock().unwrap();
                            if *force {
                                *force = false;
                                return;
                            }
                            drop(force);

                            // 阻止关闭
                            api.prevent_close();

                            // 通知前端弹出确认框
                            let _ = w.emit("close-requested", ());
                        }
                        tauri::WindowEvent::DragDrop(drag_event) => {
                            if let tauri::DragDropEvent::Drop { paths, position: _ } = drag_event {
                                if let Some(path) = paths.first() {
                                    let path_str = path.to_string_lossy().to_string();
                                    if path_str.ends_with(".md") || path_str.ends_with(".markdown") {
                                        let _ = w.emit("file-dropped", path_str);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Markdown Editor 失败");
}
