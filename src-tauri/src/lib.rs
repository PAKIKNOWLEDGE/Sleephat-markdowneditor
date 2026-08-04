use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};

// ── 配置 ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default)]
    pub vditor_options: Option<serde_json::Value>,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
    #[serde(default)]
    pub window_x: Option<i32>,
    #[serde(default)]
    pub window_y: Option<i32>,
    #[serde(default)]
    pub welcome_dark: Option<bool>,
    /// P4-5：用户自定义 CSS（原样注入 <style>，对应 config.json 的 custom_css 字段）
    #[serde(default)]
    pub custom_css: Option<String>,
    /// P4-6：图片保存目录（相对当前文件目录，默认 assets；对应 config.json 的 image_save_folder）
    #[serde(default)]
    pub image_save_folder: Option<String>,
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
            custom_css: None,
            image_save_folder: None,
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
        match fs::read_to_string(&path) {
            Ok(s) => match serde_json::from_str(&s) {
                Ok(c) => return c,
                Err(_) => {
                    // 损坏的配置文件不静默丢弃：先备份为 config.json.bak，再回落默认（L10）
                    let _ = fs::copy(&path, path.with_extension("json.bak"));
                }
            },
            Err(_) => {}
        }
        AppConfig::default()
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

/// 加锁并容忍中毒：锁被 panic 污染后取回内部值，避免一个线程 panic 全局瘫痪（M13）。
/// 只要被锁数据本身未被破坏，PoisonError 的 into_inner() 返回内部 MutexGuard，可继续使用。
fn lock_ok<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ── Tauri Commands ───────────────────────────────────────

#[tauri::command]
async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<(String, String)>, String> {
    let window = app.get_webview_window("main").ok_or("无法获取主窗口")?;

    // 非阻塞对话框：pick_file 走回调，用 channel 把结果传回 async 命令（M12，
    // 不再用 blocking_pick_file 阻塞主线程冻结 UI）
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<FilePath>>(1);
    window
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("All Files", &["*"])
        .set_title("打开 Markdown 文件")
        .pick_file(move |file| {
            let _ = tx.try_send(file);
        });

    let file = rx.recv().await.ok_or("打开文件对话框失败")?;
    let Some(path) = file else {
        return Ok(None); // 用户取消对话框
    };
    let path_str = path.to_string();
    let content = fs::read_to_string(&path_str).map_err(|e| e.to_string())?;

    let state = app.state::<AppState>();
    *lock_ok(&state.current_file) = Some(path_str.clone());
    *lock_ok(&state.is_dirty) = false;
    // 记录文件修改时间用于外部检测
    if let Ok(meta) = fs::metadata(&path_str) {
        if let Ok(mtime) = meta.modified() {
            *lock_ok(&state.last_file_mtime) = Some(mtime);
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

#[tauri::command]
fn read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    *lock_ok(&state.current_file) = Some(path.clone());
    *lock_ok(&state.is_dirty) = false;
    // 记录文件修改时间用于外部检测
    if let Ok(meta) = fs::metadata(&path) {
        if let Ok(mtime) = meta.modified() {
            *lock_ok(&state.last_file_mtime) = Some(mtime);
        }
    }
    Ok(content)
}

#[tauri::command]
fn save_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    *lock_ok(&state.is_dirty) = false;
    // 更新跟踪的 mtime，避免自我保存触发"外部修改"误报
    if let Ok(meta) = fs::metadata(&path) {
        if let Ok(mtime) = meta.modified() {
            *lock_ok(&state.last_file_mtime) = Some(mtime);
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("saved", ());
    }
    Ok(())
}

#[tauri::command]
async fn save_file_as(app: tauri::AppHandle, content: String) -> Result<Option<String>, String> {
    let window = app.get_webview_window("main").ok_or("无法获取主窗口")?;

    // 非阻塞另存为对话框（M12，替代 blocking_save_file）
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<FilePath>>(1);
    window
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_title("另存为")
        .save_file(move |file| {
            let _ = tx.try_send(file);
        });

    let file = rx.recv().await.ok_or("另存为对话框失败")?;
    let Some(path) = file else {
        return Ok(None); // 用户取消
    };
    let path_str = path.to_string();
    fs::write(&path_str, &content).map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    *lock_ok(&state.current_file) = Some(path_str.clone());
    *lock_ok(&state.is_dirty) = false;
    // 更新跟踪的 mtime，避免另存后误报"外部修改"（M6）
    if let Ok(meta) = fs::metadata(&path_str) {
        if let Ok(mtime) = meta.modified() {
            *lock_ok(&state.last_file_mtime) = Some(mtime);
        }
    }
    // 与 save_file 一致，通知前端保存完成（L12）
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("saved", ());
    }
    Ok(Some(path_str))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImageFile {
    pub base64: String,
    pub name: String,
}

/// 允许保存的媒体扩展名
const ALLOWED_MEDIA_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "wav", "mp3", "mp4", "webm",
];

#[tauri::command]
fn save_images(app: tauri::AppHandle, files: Vec<ImageFile>) -> Result<Vec<String>, String> {
    // 图片目录为「当前文件所在目录/<配置的目录>」，默认 assets；
    // 不信任前端传入路径，目录名只从配置读取并做安全校验（防路径穿越 S1）
    let current = lock_ok(&app.state::<AppState>().current_file).clone();
    let base_dir = current
        .as_deref()
        .and_then(|cf| Path::new(cf).parent())
        .map(|p| p.to_path_buf())
        .ok_or("请先保存文件再粘贴图片")?;

    // P4-6：image_save_folder 配置（相对目录，拒绝绝对路径/../穿越）
    let config = load_config(&app);
    let folder = config.image_save_folder.unwrap_or_else(|| "assets".to_string());
    let folder_path = Path::new(&folder);
    let folder_ok = !folder_path.is_absolute()
        && !folder_path
            .components()
            .any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir
                        | std::path::Component::RootDir
                        | std::path::Component::Prefix(_)
                )
            });
    if !folder_ok {
        return Err("非法的图片保存目录".to_string());
    }
    let assets_dir = base_dir.join(&folder);
    fs::create_dir_all(&assets_dir).map_err(|e| format!("创建图片目录失败: {}", e))?;

    let mut saved_paths = Vec::new();
    for file in &files {
        // 只取纯文件名，剥离任何目录成分
        let name = Path::new(&file.name)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .filter(|n| !n.is_empty() && n != "." && n != "..")
            .ok_or("非法文件名")?;
        // 扩展名白名单
        let ext = Path::new(&name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !ALLOWED_MEDIA_EXT.contains(&ext.as_str()) {
            return Err(format!("不支持的图片格式: {}", name));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&file.base64)
            .map_err(|e| format!("Base64 解码失败: {}", e))?;
        // 单文件 20MB 上限
        if bytes.len() > 20 * 1024 * 1024 {
            return Err(format!("图片过大: {}", name));
        }
        let file_path = assets_dir.join(&name);
        fs::write(&file_path, &bytes).map_err(|e| format!("写入图片失败: {}", e))?;
        // 返回相对路径（含目录），前端直接用于 markdown 相对引用（P4-6）
        saved_paths.push(format!("{}/{}", folder, name));
    }
    Ok(saved_paths)
}

/// 判断字符串是否带 URI scheme 前缀（http:、file:、C: 盘符等）
fn has_uri_scheme(url: &str) -> bool {
    let bytes = url.as_bytes();
    if !bytes.first().map(|b| b.is_ascii_alphabetic()).unwrap_or(false) {
        return false;
    }
    for (i, &c) in bytes.iter().enumerate().skip(1) {
        if c == b':' {
            return true;
        }
        if !(c.is_ascii_alphanumeric() || c == b'+' || c == b'-' || c == b'.') {
            return false;
        }
    }
    false
}

/// 拒绝的脚本注入类 scheme（S3）
const DANGEROUS_SCHEMES: &[&str] = &["javascript:", "data:", "vbscript:", "file:"];

/// 打开本地文件前拦截的执行型扩展名
const EXECUTABLE_EXT: &[&str] = &[
    "exe", "bat", "cmd", "com", "scr", "vbs", "vbe", "js", "jse", "ps1", "psm1", "lnk", "msi",
    "reg", "wsf",
];

#[tauri::command]
fn open_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // 1. 拒绝脚本注入类 scheme
    let lower = url.to_ascii_lowercase();
    for bad in DANGEROUS_SCHEMES {
        if lower.starts_with(bad) {
            return Err(format!("禁止打开该链接: {}", url));
        }
    }

    // 2. 常规 Web / 邮件链接直接交给系统浏览器
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
    {
        tauri_plugin_opener::open_path(&url, None::<&str>)
            .map_err(|e| format!("打开链接失败: {}", e))?;
        return Ok(());
    }

    // 3. 本地路径：解析为绝对路径
    let is_relative = !has_uri_scheme(&url);
    let resolved = if is_relative {
        let current = lock_ok(&app.state::<AppState>().current_file).clone();
        match current {
            Some(cf) => Path::new(&cf)
                .parent()
                .map(|dir| dir.join(&url))
                .unwrap_or_else(|| PathBuf::from(&url)),
            None => PathBuf::from(&url),
        }
    } else {
        // 绝对路径（含 Windows 盘符如 C:\...）
        PathBuf::from(&url)
    };

    // 4. 执行型文件一律拒绝
    if let Some(ext) = resolved.extension().and_then(|e| e.to_str()) {
        let e = ext.to_ascii_lowercase();
        if EXECUTABLE_EXT.contains(&e.as_str()) {
            return Err("出于安全考虑，禁止打开可执行文件".to_string());
        }
    }

    // 5. 相对链接要求落在当前文件目录内（防 ../ 越界）
    if is_relative {
        if let Ok(canon) = resolved.canonicalize() {
            let dir = lock_ok(&app.state::<AppState>().current_file)
                .clone()
                .and_then(|cf| Path::new(&cf).parent().map(|p| p.to_path_buf()));
            if let Some(dir) = dir {
                if let Ok(dir_canon) = dir.canonicalize() {
                    if !canon.starts_with(&dir_canon) {
                        return Err("链接越出文档目录，已阻止".to_string());
                    }
                }
            }
        }
    }

    tauri_plugin_opener::open_path(&resolved, None::<&str>)
        .map_err(|e| format!("打开链接失败: {}", e))
}

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    Ok(load_config(&app))
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    // 读-改-写合并：前端每次只传需要更新的字段，未传字段保留原值，
    // 避免整体覆盖清空 recent_files / welcome_dark / 窗口几何（见 S4）
    let mut existing = load_config(&app);
    if config.vditor_options.is_some() {
        existing.vditor_options = config.vditor_options;
    }
    if !config.recent_files.is_empty() {
        existing.recent_files = config.recent_files;
    }
    if config.window_width.is_some() {
        existing.window_width = config.window_width;
    }
    if config.window_height.is_some() {
        existing.window_height = config.window_height;
    }
    if config.window_x.is_some() {
        existing.window_x = config.window_x;
    }
    if config.window_y.is_some() {
        existing.window_y = config.window_y;
    }
    if config.welcome_dark.is_some() {
        existing.welcome_dark = config.welcome_dark;
    }
    save_config_to_disk(&app, &existing)
}

#[tauri::command]
fn reset_config(app: tauri::AppHandle) -> Result<(), String> {
    // 直接写默认配置，绕过 save_config 的字段合并（合并逻辑无法清空 recent_files/vditor_options）。
    // 默认 AppConfig 的 vditor_options=None、recent_files=[]，实现真正重置（修复 S4 回归）。
    let config = AppConfig::default();
    save_config_to_disk(&app, &config)
}

#[tauri::command]
fn get_current_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let result = lock_ok(&state.current_file).clone();
    Ok(result)
}

/// 新建文件后清空 Rust 端 current_file / is_dirty / mtime，避免相对链接、图片保存基准陈旧（M14）
#[tauri::command]
fn clear_current_file(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    *lock_ok(&state.current_file) = None;
    *lock_ok(&state.is_dirty) = false;
    *lock_ok(&state.last_file_mtime) = None;
    Ok(())
}

#[tauri::command]
fn set_dirty(app: tauri::AppHandle, dirty: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    *lock_ok(&state.is_dirty) = dirty;
    Ok(())
}

#[tauri::command]
fn is_dirty(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let result = *lock_ok(&state.is_dirty);
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
    *lock_ok(&state.force_close) = true;
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
    let mut last_mtime = lock_ok(&state.last_file_mtime);
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

// ── 自定义 asset 协议（P4-1 / M10 根治）──────────────────
// markdown 中相对路径 `![](assets/x.png)` 桌面端默认不解析 → 404。
// 前端把相对 src 改写成 `vmd-asset://localhost/<path>`，此协议按「当前文件目录」
// 解析相对路径并返回文件内容，实现图片/音视频预览。

/// 简易百分号解码（URL path 中的 %XX）
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (
                (b[i + 1] as char).to_digit(16),
                (b[i + 2] as char).to_digit(16),
            ) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 按扩展名给媒体文件一个粗略 MIME（够浏览器识别图片/音视频即可）
fn mime_for(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn asset_not_found() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::NOT_FOUND)
        .body(Vec::new())
        .unwrap()
}

/// 协议处理器：相对路径按当前文件目录解析，并要求 canonicalize 后仍落在该目录内（防穿越）。
fn serve_asset_media(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::header;
    let decoded = percent_decode(request.uri().path().trim_start_matches('/'));
    let current = lock_ok(&app.state::<AppState>().current_file).clone();
    let Some(cf) = current else {
        return asset_not_found();
    };
    let Some(base_dir) = Path::new(&cf).parent().map(|p| p.to_path_buf()) else {
        return asset_not_found();
    };
    let target = base_dir.join(&decoded);
    // canonicalize 同时校验「文件存在」与「不越出文档目录」
    let contained = match (target.canonicalize(), base_dir.canonicalize()) {
        (Ok(t), Ok(b)) => t.starts_with(&b),
        _ => false,
    };
    if !contained {
        return asset_not_found();
    }
    let data = match fs::read(&target) {
        Ok(d) => d,
        Err(_) => return asset_not_found(),
    };
    let mime = mime_for(target.extension().and_then(|e| e.to_str()).unwrap_or(""));
    tauri::http::Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .status(tauri::http::StatusCode::OK)
        .body(data)
        .unwrap_or_else(|_| asset_not_found())
}

// ── 应用入口 ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK 在 Wayland 上 GPU 合成有问题 → 白屏，走 CPU 合成。
    // 仅在 Wayland 下禁用（L11）：X11 保留 GPU 合成，不影响 Windows/macOS。
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WAYLAND_DISPLAY").is_ok() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    tauri::Builder::default()
        // P4-1：自定义媒体协议，按当前文件目录解析相对路径图片/音视频
        .register_uri_scheme_protocol("vmd-asset", |ctx, request| {
            serve_asset_media(ctx.app_handle(), request)
        })
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
            reset_config,
            get_current_file,
            clear_current_file,
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
                        *lock_ok(&state.current_file) = Some(path.clone());
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
                            let mut force = lock_ok(&state.force_close);
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
