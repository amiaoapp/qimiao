//! Native text / HTML / image / file clipboard support, with disk-backed originals.
use crate::webdav::{self, DavConfig, DavRuntime};
use base64::{engine::general_purpose::STANDARD, Engine};
use clipboard_rs::{
    common::{RustImage, RustImageData},
    Clipboard, ClipboardContent, ClipboardContext,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct ClipboardRuntime {
    sequence: Mutex<Option<u64>>,
    fingerprint: Mutex<String>,
    io: Mutex<()>,
}
// X11 ClipboardContext owns a serving thread. Reuse one context rather than
// leaking a thread and X connection on every capture tick.
fn context() -> Result<std::sync::MutexGuard<'static, Option<ClipboardContext>>, String> {
    static CONTEXT: Mutex<Option<ClipboardContext>> = Mutex::new(None);
    let mut context = CONTEXT.lock().map_err(|_| "剪贴板状态不可用")?;
    if context.is_none() {
        *context = Some(ClipboardContext::new().map_err(|_| "无法访问系统剪贴板")?);
    }
    Ok(context)
}
pub fn read_text() -> Result<String, String> {
    context()?
        .as_ref()
        .ok_or("无法访问系统剪贴板")?
        .get_text()
        .map_err(|_| "剪贴板中没有文本".into())
}
pub fn write_text(text: String) -> Result<(), String> {
    context()?
        .as_ref()
        .ok_or("无法访问系统剪贴板")?
        .set_text(text)
        .map_err(|_| "写入剪贴板失败".into())
}
fn millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("clipboard");
    fs::create_dir_all(folder.join("images")).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&folder, fs::Permissions::from_mode(0o700));
    }
    Ok(folder)
}
pub fn image_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("图片标识不合法".into());
    }
    Ok(folder(app)?.join("images").join(format!("{key}.png")))
}
fn sequence() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        Some(objc2_app_kit::NSPasteboard::generalPasteboard().changeCount() as u64)
    }
    #[cfg(target_os = "windows")]
    {
        Some(
            unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }
                as u64,
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}
fn source_app() -> (String, String) {
    #[cfg(target_os = "macos")]
    {
        if let Some(app) = objc2_app_kit::NSWorkspace::sharedWorkspace().frontmostApplication() {
            return (
                app.localizedName()
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
                app.bundleIdentifier()
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
            );
        }
    }
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            },
            UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
        };
        let mut pid = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), &mut pid);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !process.is_null() {
            let mut buffer = [0_u16; 4096];
            let mut length = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
            CloseHandle(process);
            if ok != 0 {
                let path = String::from_utf16_lossy(&buffer[..length as usize]);
                let name = std::path::Path::new(&path)
                    .file_name()
                    .map(|v| v.to_string_lossy().into_owned())
                    .unwrap_or_default();
                return (name.clone(), name);
            }
        }
    }
    (String::new(), String::new())
}
fn snapshot(app: &tauri::AppHandle, ignored_apps: &[String]) -> Result<Option<Value>, String> {
    let state = app.state::<ClipboardRuntime>();
    let current = sequence();
    if let Some(seq) = current {
        let previous = state.sequence.lock().map_err(|_| "剪贴板状态不可用")?;
        if *previous == Some(seq) {
            return Ok(None);
        }
    }
    let guard = context()?;
    let context = guard.as_ref().ok_or("无法访问系统剪贴板")?;
    let (source, source_id) = source_app();
    let source_key = format!("{source} {source_id}").to_lowercase();
    if ignored_apps
        .iter()
        .any(|name| !name.trim().is_empty() && source_key.contains(&name.trim().to_lowercase()))
    {
        return Ok(None);
    }
    let formats = context.available_formats().unwrap_or_default();
    if formats
        .iter()
        .any(|format| format.contains("ConcealedType") || format.contains("TransientType"))
    {
        return Ok(None);
    }
    let text = context.get_text().unwrap_or_default();
    if text.len() > 1_000_000 {
        return Err("剪贴板文本超过 1 MB，已跳过记录".into());
    }
    let files = context
        .get_files()
        .unwrap_or_default()
        .into_iter()
        .take(128)
        .collect::<Vec<_>>();
    let mut value = json!({ "text":text, "files":files });
    let image = if files.is_empty() {
        context.get_image().ok().filter(|image| !image.is_empty())
    } else {
        None
    };
    let mut hash = Sha256::new();
    hash.update(text.as_bytes());
    for path in &files {
        hash.update(path.as_bytes());
        hash.update([0]);
    }
    let kind = if !files.is_empty() {
        "file"
    } else if let Some(image) = image {
        let (width, height) = image.get_size();
        if width as u64 * height as u64 > 32_000_000 {
            return Err("图片超过 3200 万像素，已跳过记录".into());
        }
        let png = image.to_png().map_err(|_| "无法读取剪贴板图片")?;
        if png.get_bytes().len() > 10 * 1024 * 1024 {
            return Err("图片超过 10 MB，已跳过记录".into());
        }
        let key = format!("{:x}", Sha256::digest(png.get_bytes()));
        hash.update(png.get_bytes());
        let path = image_path(app, &key)?;
        if !path.exists() {
            fs::write(&path, png.get_bytes()).map_err(|error| error.to_string())?;
        }
        value["imageKey"] = json!(key);
        value["width"] = json!(width);
        value["height"] = json!(height);
        if let Ok(thumbnail) = image.thumbnail(320, 200).and_then(|image| image.to_png()) {
            value["thumbnail"] = json!(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(thumbnail.get_bytes())
            ));
        }
        "image"
    } else {
        "text"
    };
    if kind == "text" && text.trim().is_empty() {
        return Ok(None);
    }
    let id = format!("{:x}", hash.finalize());
    // Only acknowledge a sequence after successfully reading the payload. A
    // denied/temporarily unavailable pasteboard must be retried on the next tick.
    if let Some(seq) = current {
        *state.sequence.lock().map_err(|_| "剪贴板状态不可用")? = Some(seq);
    }
    let mut previous = state.fingerprint.lock().map_err(|_| "剪贴板状态不可用")?;
    if *previous == id {
        return Ok(None);
    }
    *previous = id.clone();
    let html = context
        .get_html()
        .ok()
        .filter(|html| html.len() < 1_000_000);
    value["id"] = json!(id);
    value["kind"] = json!(kind);
    value["html"] = json!(html);
    value["sourceApp"] = json!(source);
    value["sourceId"] = json!(source_id);
    value["createdAt"] = json!(millis());
    value["updatedAt"] = value["createdAt"].clone();
    Ok(Some(value))
}
#[tauri::command]
pub async fn clipboard_snapshot(
    app: tauri::AppHandle,
    ignored_apps: Vec<String>,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || snapshot(&app, &ignored_apps))
        .await
        .map_err(|_| "剪贴板读取任务失败")?
}
#[tauri::command]
pub async fn load_clipboard_history(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = folder(&app)?.join("history.json");
        if !path.exists() {
            return Ok(json!([]));
        }
        if fs::metadata(&path)
            .map_err(|error| error.to_string())?
            .len()
            > 24 * 1024 * 1024
        {
            return Err("剪贴板数据库超过安全大小限制".into());
        }
        serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|_| "剪贴板数据库无法读取".into())
    })
    .await
    .map_err(|_| "读取任务失败")?
}
#[tauri::command]
pub async fn save_clipboard_history(app: tauri::AppHandle, entries: Value) -> Result<(), String> {
    let items = entries.as_array().ok_or("剪贴板数据必须是数组")?;
    if items.len() > 10000 {
        return Err("剪贴板记录过多".into());
    }
    let bytes = serde_json::to_vec(&entries).map_err(|error| error.to_string())?;
    if bytes.len() > 24 * 1024 * 1024 {
        return Err("剪贴板数据库超过 24 MB，请减少保留条目".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ClipboardRuntime>();
        let _guard = state.io.lock().map_err(|_| "存储状态不可用")?;
        let folder = folder(&app)?;
        let temp = folder.join("history.tmp");
        fs::write(&temp, bytes).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
        fs::rename(temp, folder.join("history.json")).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "保存任务失败")?
}
fn put_clipboard(app: &tauri::AppHandle, clip: &Value, plain: bool) -> Result<(), String> {
    let guard = context()?;
    let context = guard.as_ref().ok_or("无法访问系统剪贴板")?;
    let text = clip
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if !plain {
        if let Some(key) = clip.get("imageKey").and_then(Value::as_str) {
            let path = image_path(app, key)?;
            let image = RustImageData::from_path(path.to_str().ok_or("图片路径无效")?)
                .map_err(|_| "原图不在本机，请先下载图片或同步剪贴板")?;
            return context.set_image(image).map_err(|_| "写入图片失败".into());
        }
        if let Some(files) = clip
            .get("files")
            .and_then(Value::as_array)
            .filter(|files| !files.is_empty())
        {
            let files: Vec<_> = files
                .iter()
                .filter_map(Value::as_str)
                .map(|path| {
                    reqwest::Url::parse(path)
                        .ok()
                        .filter(|url| url.scheme() == "file")
                        .and_then(|url| url.to_file_path().ok())
                        .map(|path| path.to_string_lossy().into_owned())
                        .unwrap_or_else(|| path.to_string())
                })
                .collect();
            if files
                .iter()
                .any(|path| !std::path::Path::new(path).exists())
            {
                return Err("某些文件不在这台电脑上。文件仅同步路径，不会上传原文件".into());
            }
            return context
                .set_files(files)
                .map_err(|_| "写入文件剪贴板失败".into());
        }
        if let Some(html) = clip
            .get("html")
            .and_then(Value::as_str)
            .filter(|html| !html.is_empty())
        {
            return context
                .set(vec![
                    ClipboardContent::Text(text),
                    ClipboardContent::Html(html.to_string()),
                ])
                .map_err(|_| "写入富文本失败".into());
        }
    }
    context.set_text(text).map_err(|_| "写入剪贴板失败".into())
}
#[tauri::command]
pub async fn copy_clipboard_item(
    app: tauri::AppHandle,
    clip: Value,
    plain: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || put_clipboard(&app, &clip, plain))
        .await
        .map_err(|_| "复制任务失败")?
}
#[tauri::command]
pub async fn paste_clipboard_item(
    app: tauri::AppHandle,
    clip: Value,
    plain: bool,
    press_enter: bool,
) -> Result<(), String> {
    let cloned = app.clone();
    let paste_clip = clip.clone();
    tauri::async_runtime::spawn_blocking(move || put_clipboard(&cloned, &paste_clip, plain))
        .await
        .map_err(|_| "粘贴任务失败")??;
    if *app.state::<crate::tool_windows::ToolWindows>().launcher_target.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) {
        if let Some(window) = app.get_webview_window("clipboard") { let _ = window.hide(); }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        if let Some(text) = clip.get("text").and_then(Value::as_str).filter(|text| !text.is_empty()) {
            let _ = app.emit_to("main", "clipboard-insert-search", text);
        }
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    if !crate::macos_tools::paste_allowed() {
        return Err("QIMIAO_MACOS_PASTE_PERMISSION".into());
    }
    for label in ["main", "clipboard"] {
        if let Some(window) = app.get_webview_window(label) { let _ = window.hide(); }
    }
    let paste_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(180));
        crate::tool_windows::restore_target(&paste_app)?;
        #[cfg(target_os = "macos")] {
            crate::macos_tools::paste(press_enter)?;
        }
        #[cfg(target_os = "windows")] unsafe {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
            let key = |vk, up| INPUT { r#type:INPUT_KEYBOARD, Anonymous:INPUT_0 { ki:KEYBDINPUT { wVk:vk, wScan:0, dwFlags:if up { KEYEVENTF_KEYUP } else { 0 }, time:0, dwExtraInfo:0 } } };
            let mut inputs = vec![key(VK_CONTROL, false), key(0x56, false), key(0x56, true), key(VK_CONTROL, true)];
            if press_enter { inputs.extend([key(VK_RETURN, false), key(VK_RETURN, true)]); }
            if SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) != inputs.len() as u32 { return Err("自动粘贴被系统阻止，内容已复制，可手动按 Ctrl+V".into()); }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))] {
            let output = std::process::Command::new("xdotool").args(if press_enter { vec!["key", "--clearmodifiers", "ctrl+v", "Return"] } else { vec!["key", "--clearmodifiers", "ctrl+v"] }).output().map_err(|_| "内容已复制；自动粘贴需要 xdotool，Wayland 下请手动粘贴")?;
            if !output.status.success() { return Err("内容已复制；该桌面未允许模拟粘贴，请手动粘贴".into()); }
        }
        Ok(())
    }).await.map_err(|_| "粘贴任务失败")?;
    if result.is_err() {
        crate::show_launcher_mode(&app, "clipboard");
    }
    result
}
#[tauri::command]
pub async fn export_clipboard_item(
    app: tauri::AppHandle,
    clip: Value,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<crate::WindowRuntime>();
        runtime
            .native_dialog_open
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let image = clip.get("imageKey").and_then(Value::as_str);
        let path = rfd::FileDialog::new()
            .set_file_name(if image.is_some() {
                "clipboard.png"
            } else {
                "clipboard.txt"
            })
            .save_file();
        runtime
            .native_dialog_open
            .store(false, std::sync::atomic::Ordering::SeqCst);
        runtime.protect_focus(Duration::from_millis(800));
        let Some(path) = path else {
            return Ok(None);
        };
        if let Some(key) = image {
            fs::copy(image_path(&app, key)?, &path).map_err(|error| error.to_string())?;
        } else {
            fs::write(
                &path,
                clip.get("text").and_then(Value::as_str).unwrap_or_default(),
            )
            .map_err(|error| error.to_string())?;
        }
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|_| "导出任务失败")?
}
#[tauri::command]
pub async fn webdav_image(
    app: tauri::AppHandle,
    config: DavConfig,
    key: String,
    upload: bool,
) -> Result<(), String> {
    let path = image_path(&app, &key)?;
    if !upload && path.exists() {
        return Ok(());
    }
    let password = webdav::session_password(&config, &app.state::<DavRuntime>())?;
    tauri::async_runtime::spawn_blocking(move || {
        let name = format!("images/{key}.png");
        if upload {
            if webdav::image_exists(&config, &password, &name)? {
                return Ok(());
            }
            if !path.exists() {
                return Err("本机原图不存在，未上传记录".into());
            }
            let bytes = fs::read(&path).map_err(|error| error.to_string())?;
            match webdav::write_bytes(&config, &password, &name, bytes, None, None, false) {
                Err(error) if error.contains("另一台设备") => Ok(()),
                result => result,
            }
        } else {
            if path.exists() {
                return Ok(());
            }
            let (bytes, _, _) = webdav::read_bytes(&config, &password, &name, 10 * 1024 * 1024)?
                .ok_or("远端原图不存在")?;
            if format!("{:x}", Sha256::digest(&bytes)) != key {
                return Err("原图校验失败，未保存".into());
            }
            let (width, height) = image::ImageReader::with_format(
                std::io::Cursor::new(&bytes),
                image::ImageFormat::Png,
            )
            .into_dimensions()
            .map_err(|_| "远端不是有效 PNG")?;
            if width as u64 * height as u64 > 32_000_000 {
                return Err("远端图片超过 3200 万像素，未下载".into());
            }
            image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                .map_err(|_| "远端不是有效 PNG")?;
            fs::write(path, bytes).map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|_| "图片同步任务失败")?
}
