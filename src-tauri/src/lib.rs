use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt as AutoStartManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use walkdir::WalkDir;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
fn hidden_windows_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppItem {
    id: String,
    name: String,
    path: String,
    icon: Option<String>,
    search_terms: String,
    installed_at: Option<u64>,
    launch_count: u32,
    favorite: bool,
    manual: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionCommand {
    id: String,
    extension_name: String,
    extension_title: String,
    owner: Option<String>,
    command_name: String,
    title: String,
    description: String,
    mode: String,
    icon: Option<String>,
    preferences: Vec<serde_json::Value>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionAsset {
    path: String,
    data: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionBundle {
    command: ExtensionCommand,
    code: String,
    assets: Vec<ExtensionAsset>,
    extension_path: String,
}
#[derive(Debug, Deserialize)]
struct ExtensionBundleTicket {
    url: String,
}
struct ShortcutRuntime {
    double_control: AtomicBool,
    last_control: Mutex<Option<Instant>>,
}
impl Default for ShortcutRuntime {
    fn default() -> Self {
        Self {
            double_control: AtomicBool::new(false),
            last_control: Mutex::new(None),
        }
    }
}

fn default_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(target_os = "macos")]
    {
        dirs.extend([
            PathBuf::from("/Applications"),
            PathBuf::from("/System/Applications"),
        ]);
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join("Applications"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(path) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(path).join("Microsoft/Windows/Start Menu/Programs"));
        }
        if let Some(path) = std::env::var_os("PROGRAMDATA") {
            dirs.push(PathBuf::from(path).join("Microsoft/Windows/Start Menu/Programs"));
        }
        // Desktop folders commonly contain document shortcuts. Automatic
        // discovery intentionally stays inside the application-only Start Menu;
        // standalone executables can be added explicitly from Settings.
    }
    #[cfg(target_os = "linux")]
    {
        dirs.extend([
            PathBuf::from("/usr/share/applications"),
            PathBuf::from("/usr/local/share/applications"),
        ]);
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join(".local/share/applications"));
        }
    }
    dirs
}

fn is_app(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        path.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("app"))
    }
    #[cfg(target_os = "windows")]
    {
        path.extension().is_some_and(|e| {
            matches!(
                e.to_string_lossy().to_ascii_lowercase().as_str(),
                "exe" | "lnk"
            )
        })
    }
    #[cfg(target_os = "linux")]
    {
        path.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("desktop"))
    }
}

#[cfg(any(target_os = "windows", test))]
fn looks_like_windows_non_app(path: &Path) -> bool {
    let name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .trim()
        .to_lowercase();
    let compact: String = name
        .chars()
        .filter(|character| !character.is_whitespace() && !"-_()[]".contains(*character))
        .collect();
    let obvious_action = [
        "uninstall",
        "unins",
        "remove",
        "repair",
        "modify",
        "setup",
        "installer",
        "updater",
        "卸载",
        "移除",
        "删除",
        "修复",
        "安装",
    ]
    .iter()
    .any(|prefix| compact.starts_with(prefix));
    let uninstall_directory = path.ancestors().skip(1).any(|parent| {
        parent
            .file_name()
            .map(|value| value.to_string_lossy().to_lowercase())
            .is_some_and(|value| value == "uninstall" || value == "uninstaller" || value == "卸载")
    });
    obvious_action || uninstall_directory
}

fn color_for(name: &str) -> String {
    let palette = [
        "#536dfe", "#ef5350", "#26a69a", "#7e57c2", "#42a5f5", "#ec407a", "#ff8f00", "#455a64",
    ];
    let n = name.bytes().fold(0usize, |a, b| a + b as usize);
    format!(
        "{}|{}",
        palette[n % palette.len()],
        name.chars().next().unwrap_or('?')
    )
}

#[cfg(target_os = "macos")]
fn normalize_icon(path: &Path) {
    let Ok(source) = image::open(path).map(|i| i.to_rgba8()) else {
        return;
    };
    let (w, h) = source.dimensions();
    let mut bounds = (w, h, 0, 0);
    for y in 0..h {
        for x in 0..w {
            if source.get_pixel(x, y)[3] > 10 {
                bounds.0 = bounds.0.min(x);
                bounds.1 = bounds.1.min(y);
                bounds.2 = bounds.2.max(x);
                bounds.3 = bounds.3.max(y)
            }
        }
    }
    if bounds.2 <= bounds.0 || bounds.3 <= bounds.1 {
        return;
    }
    let crop = image::imageops::crop_imm(
        &source,
        bounds.0,
        bounds.1,
        bounds.2 - bounds.0 + 1,
        bounds.3 - bounds.1 + 1,
    )
    .to_image();
    let scale = (144.0 / crop.width() as f32).min(144.0 / crop.height() as f32);
    let nw = (crop.width() as f32 * scale).round() as u32;
    let nh = (crop.height() as f32 * scale).round() as u32;
    let resized = image::imageops::resize(&crop, nw, nh, image::imageops::FilterType::Lanczos3);
    let mut canvas = image::RgbaImage::new(160, 160);
    image::imageops::overlay(
        &mut canvas,
        &resized,
        ((160 - nw) / 2) as i64,
        ((160 - nh) / 2) as i64,
    );
    let _ = canvas.save(path);
}

#[cfg(target_os = "macos")]
fn ios_wrapped_icon(path: &Path) -> Option<String> {
    let wrapper = path.join("Wrapper");
    if !wrapper.exists() {
        return None;
    }
    let mut icons: Vec<(bool, u64, PathBuf)> = WalkDir::new(&wrapper)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let p = e.into_path();
            let filename = p.file_name()?.to_string_lossy().to_ascii_lowercase();
            let directly_in_app = p
                .parent()?
                .extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("app"));
            if !directly_in_app
                || !filename.contains("icon")
                || p.extension().is_none_or(|x| !x.eq_ignore_ascii_case("png"))
            {
                return None;
            }
            let (w, h) = image::image_dimensions(&p).ok()?;
            Some((
                filename.starts_with("appicon"),
                u64::from(w) * u64::from(h),
                p,
            ))
        })
        .collect();
    icons.sort_by_key(|(preferred, area, _)| std::cmp::Reverse((*preferred, *area)));
    let (_, _, source) = icons.into_iter().next()?;
    let digest = format!(
        "{:x}",
        Sha256::digest(format!("ios-icon-v3:{}", source.to_string_lossy()).as_bytes())
    );
    let cache = std::env::temp_dir().join("miaoqi-icons");
    let _ = fs::create_dir_all(&cache);
    let output = cache.join(format!("{digest}.png"));
    if !output.exists() {
        fs::copy(source, &output).ok()?;
        normalize_icon(&output)
    }
    fs::read(output)
        .ok()
        .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[cfg(target_os = "macos")]
fn app_icon(path: &Path, name: &str) -> String {
    if let Some(icon) = ios_wrapped_icon(path) {
        return icon;
    }
    if path.starts_with("/System/Applications") {
        return quicklook_icon(path, name);
    }
    let resources = path.join("Contents/Resources");
    let declared = plist::Value::from_file(path.join("Contents/Info.plist"))
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|d| {
            d.get("CFBundleIconFile")
                .or_else(|| d.get("CFBundleIconName"))
                .and_then(|v| v.as_string())
                .map(str::to_owned)
        });
    let mut candidates: Vec<PathBuf> = fs::read_dir(&resources)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("icns"))
        })
        .collect();
    let normalized = |s: &str| s.to_lowercase().replace([' ', '-', '_'], "");
    candidates.sort_by_key(|candidate| {
        let stem = candidate.file_stem().unwrap_or_default().to_string_lossy();
        let n = normalized(&stem);
        let app = normalized(name);
        let declared_match = declared
            .as_ref()
            .is_some_and(|d| normalized(d.trim_end_matches(".icns")) == n);
        let bad = n.contains("document")
            || n.contains("file")
            || n.contains("toolbar")
            || n.contains("template");
        -(if declared_match {
            1000
        } else if n == app {
            500
        } else if n == "appicon" || n == "icon" {
            300
        } else if n.contains(&app) || app.contains(&n) {
            150
        } else if bad {
            -200
        } else {
            0
        })
    });
    let Some(icns) = candidates.into_iter().next() else {
        return quicklook_icon(path, name);
    };
    let digest = format!(
        "{:x}",
        Sha256::digest(format!("icon-v4:{}", icns.to_string_lossy()).as_bytes())
    );
    let cache = std::env::temp_dir().join("miaoqi-icons");
    let _ = fs::create_dir_all(&cache);
    let png = cache.join(format!("{digest}.png"));
    if !png.exists() {
        let _ = Command::new("sips")
            .args(["-s", "format", "png", "-Z", "160"])
            .arg(&icns)
            .arg("--out")
            .arg(&png)
            .output();
        normalize_icon(&png);
    }
    fs::read(png)
        .ok()
        .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
        .unwrap_or_else(|| quicklook_icon(path, name))
}

#[cfg(target_os = "macos")]
fn quicklook_icon(path: &Path, name: &str) -> String {
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSString};
    let digest = format!(
        "{:x}",
        Sha256::digest(format!("workspace-v2:{}", path.to_string_lossy()).as_bytes())
    );
    let cache = std::env::temp_dir().join("miaoqi-quicklook").join(&digest);
    let _ = fs::create_dir_all(&cache);
    let output = cache.join("icon.png");
    if !output.exists() {
        autoreleasepool(|_| {
            let image = NSWorkspace::sharedWorkspace()
                .iconForFile(&NSString::from_str(&path.to_string_lossy()));
            let Some(tiff) = image.TIFFRepresentation() else {
                return;
            };
            let Some(rep) = NSBitmapImageRep::imageRepWithData(&tiff) else {
                return;
            };
            let props = NSDictionary::new();
            let Some(data) = (unsafe {
                rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props)
            }) else {
                return;
            };
            let _ =
                data.writeToFile_atomically(&NSString::from_str(&output.to_string_lossy()), true);
        });
        normalize_icon(&output);
    }
    fs::read(output)
        .ok()
        .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
        .unwrap_or_else(|| color_for(name))
}
#[cfg(target_os = "windows")]
fn app_icon(path: &Path, name: &str) -> String {
    let metadata = fs::metadata(path).ok();
    let modified = metadata
        .as_ref()
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or_default();
    let digest = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "windows-icon-v3:{}:{}:{}",
                path.to_string_lossy(),
                metadata
                    .as_ref()
                    .map(|value| value.len())
                    .unwrap_or_default(),
                modified
            )
            .as_bytes()
        )
    );
    let cache = std::env::temp_dir().join("miaoqi-icons-windows");
    let output_path = cache.join(format!("{digest}.png"));
    if let Ok(bytes) = fs::read(&output_path) {
        return format!("data:image/png;base64,{}", STANDARD.encode(bytes));
    }
    let _ = fs::create_dir_all(&cache);
    let script = r#"
$p = $env:QIMAO_ICON_SOURCE
$out = $env:QIMAO_ICON_OUTPUT
try {
  Add-Type -AssemblyName System.Drawing
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class QimiaoShellIcon {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEINFO {
    public IntPtr hIcon;
    public int iIcon;
    public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SHGetFileInfo(string path, uint attributes, ref SHFILEINFO info, uint size, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
  $info = New-Object QimiaoShellIcon+SHFILEINFO
  $flags = 0x00000100
  [void][QimiaoShellIcon]::SHGetFileInfo($p, 0, [ref]$info, [Runtime.InteropServices.Marshal]::SizeOf($info), $flags)
  if ($info.hIcon -eq [IntPtr]::Zero) { exit 2 }
  $icon = [System.Drawing.Icon]::FromHandle($info.hIcon).Clone()
  [void][QimiaoShellIcon]::DestroyIcon($info.hIcon)
  $bitmap = $icon.ToBitmap()
  $bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  $icon.Dispose()
} catch { exit 3 }
"#;
    let _ = fs::remove_file(&output_path);
    hidden_windows_command("powershell")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("QIMAO_ICON_SOURCE", path)
        .env("QIMAO_ICON_OUTPUT", &output_path)
        .status()
        .ok()
        .filter(|status| status.success())
        .and_then(|_| fs::read(&output_path).ok())
        .filter(|bytes| !bytes.is_empty())
        .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
        .unwrap_or_else(|| color_for(name))
}

#[cfg(target_os = "linux")]
fn app_icon(_path: &Path, name: &str) -> String {
    color_for(name)
}

#[cfg(target_os = "macos")]
fn localized_app_name(path: &Path, fallback: &str) -> String {
    for locale in [
        "zh-Hans.lproj",
        "zh_CN.lproj",
        "zh-Hant.lproj",
        "zh_TW.lproj",
        "Chinese.lproj",
    ] {
        let strings = path
            .join("Contents/Resources")
            .join(locale)
            .join("InfoPlist.strings");
        if !strings.exists() {
            continue;
        }
        if let Ok(output) = Command::new("plutil")
            .args(["-convert", "json", "-o", "-"])
            .arg(&strings)
            .output()
        {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                for key in ["CFBundleDisplayName", "CFBundleName"] {
                    if let Some(name) = value.get(key).and_then(|v| v.as_str()) {
                        if !name.trim().is_empty() {
                            return name.to_owned();
                        }
                    }
                }
            }
        }
    }
    plist::Value::from_file(path.join("Contents/Info.plist"))
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|d| {
            d.get("CFBundleDisplayName")
                .or_else(|| d.get("CFBundleName"))
                .and_then(|v| v.as_string())
                .map(str::to_owned)
        })
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}
#[cfg(not(target_os = "macos"))]
fn localized_app_name(_path: &Path, fallback: &str) -> String {
    fallback.to_owned()
}

fn scan_apps_blocking(extra_dirs: Vec<String>) -> Vec<AppItem> {
    let mut roots = default_dirs();
    let _automatic_roots = roots.len();
    roots.extend(extra_dirs.into_iter().map(PathBuf::from));
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for (_root_index, root) in roots.into_iter().enumerate() {
        if !root.exists() {
            continue;
        }
        let max_depth = if cfg!(target_os = "macos") { 3 } else { 5 };
        for entry in WalkDir::new(root)
            .max_depth(max_depth)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            let path = entry.path();
            if !is_app(path) {
                continue;
            }
            #[cfg(target_os = "windows")]
            {
                let extension = path
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_ascii_lowercase();
                if (_root_index < _automatic_roots && extension != "lnk")
                    || (_root_index >= _automatic_roots && extension == "exe" && entry.depth() > 2)
                    || looks_like_windows_non_app(path)
                {
                    continue;
                }
            }
            let raw = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if raw.is_empty() || raw.starts_with('.') || !seen.insert(raw.to_lowercase()) {
                continue;
            }
            if let Some(app) = app_item_from_path(path, false) {
                result.push(app);
            }
        }
    }
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

fn app_item_from_path(path: &Path, manual: bool) -> Option<AppItem> {
    if !is_app(path) {
        return None;
    }
    let raw = path.file_stem()?.to_string_lossy().to_string();
    if raw.is_empty() || raw.starts_with('.') {
        return None;
    }
    let display_name = localized_app_name(path, &raw);
    let canonical = path.to_string_lossy().to_string();
    let id = format!("{:x}", Sha256::digest(canonical.as_bytes()));
    let installed_at = fs::metadata(path)
        .ok()
        .and_then(|m| m.created().or_else(|_| m.modified()).ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Some(AppItem {
        id,
        name: display_name.clone(),
        path: canonical.clone(),
        icon: Some(format!("app:{canonical}")),
        search_terms: format!("{} {}", display_name, raw),
        installed_at,
        launch_count: 0,
        favorite: false,
        manual,
    })
}

#[tauri::command]
async fn scan_apps(extra_dirs: Vec<String>) -> Result<Vec<AppItem>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_apps_blocking(extra_dirs))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn launch_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&path);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = hidden_windows_command("cmd");
        c.args(["/C", "start", "", &path]);
        c
    };
    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = Command::new("gtk-launch");
        c.arg(Path::new(&path).file_stem().unwrap_or_default());
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn choose_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn choose_app() -> Option<AppItem> {
    let mut dialog = rfd::FileDialog::new();
    #[cfg(target_os = "macos")]
    {
        dialog = dialog.add_filter("macOS 应用", &["app"]);
    }
    #[cfg(target_os = "windows")]
    {
        dialog = dialog.add_filter("Windows 应用", &["exe", "lnk"]);
    }
    #[cfg(target_os = "linux")]
    {
        dialog = dialog.add_filter("Linux 应用", &["desktop"]);
    }
    dialog
        .pick_file()
        .and_then(|path| app_item_from_path(&path, true))
}

#[tauri::command]
fn open_plugin_directory(app: tauri::AppHandle) -> Result<String, String> {
    let dir = extensions_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = hidden_windows_command("explorer");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    command.arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn clipboard_text() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let output = Command::new("pbpaste").output();
    #[cfg(target_os = "windows")]
    let output = hidden_windows_command("powershell")
        .args(["-NoProfile", "-Command", "Get-Clipboard -Raw"])
        .output();
    #[cfg(target_os = "linux")]
    let output = Command::new("sh")
        .args([
            "-c",
            "wl-paste 2>/dev/null || xclip -selection clipboard -o",
        ])
        .output();
    let output = output.map_err(|e| e.to_string())?;
    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|e| e.to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("仅支持 http/https 链接".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = hidden_windows_command("cmd");
        c.args(["/C", "start", "", &url]);
        c
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };
    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn extensions_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("extensions"))
        .map_err(|e| e.to_string())
}

fn file_data_url(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let mime = match path
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase()
        .as_str()
    {
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn manifest_icon(dir: &Path, value: &serde_json::Value) -> Option<String> {
    let icon = value.get("icon").and_then(|v| v.as_str())?;
    [dir.join(icon), dir.join("assets").join(icon)]
        .into_iter()
        .find_map(|path| file_data_url(&path))
}

fn scan_extension_commands_in(root: &Path) -> Vec<ExtensionCommand> {
    let mut result = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return result;
    };
    for entry in entries.filter_map(Result::ok) {
        let dir = entry.path();
        let Ok(raw) = fs::read_to_string(dir.join("package.json")) else {
            continue;
        };
        let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let fallback_name = entry.file_name().to_string_lossy().into_owned();
        let extension_name = fs::read_to_string(dir.join(".qimao-source-name"))
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or(fallback_name);
        let extension_title = pkg
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(&extension_name)
            .to_owned();
        let owner = pkg
            .get("owner")
            .or_else(|| pkg.get("author"))
            .and_then(|v| {
                if let Some(s) = v.as_str() {
                    Some(s)
                } else {
                    v.get("name").and_then(|n| n.as_str())
                }
            })
            .map(str::to_owned);
        let package_icon = manifest_icon(&dir, &pkg);
        let extension_preferences = pkg
            .get("preferences")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let Some(commands) = pkg.get("commands").and_then(|v| v.as_array()) else {
            continue;
        };
        for command in commands {
            let Some(command_name) = command.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            let title = command
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or(command_name)
                .to_owned();
            let description = command
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            let mode = command
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("view")
                .to_owned();
            // Menu-bar commands require a persistent native menu host. Do not
            // advertise them as runnable launcher commands. A command without
            // its pre-built bundle is likewise not executable in Qimiao.
            if mode == "menu-bar"
                || !dir
                    .join(".sc-build")
                    .join(format!("{command_name}.js"))
                    .is_file()
            {
                continue;
            }
            let icon = manifest_icon(&dir, command).or_else(|| package_icon.clone());
            let mut preferences = extension_preferences.clone();
            preferences.extend(
                command
                    .get("preferences")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default(),
            );
            result.push(ExtensionCommand {
                id: format!("{extension_name}:{command_name}"),
                extension_name: extension_name.clone(),
                extension_title: extension_title.clone(),
                owner: owner.clone(),
                command_name: command_name.to_owned(),
                title,
                description,
                mode,
                icon,
                preferences,
            })
        }
    }
    result.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    result
}

fn safe_extension_part(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@'))
    {
        Err("扩展标识无效".into())
    } else {
        Ok(value)
    }
}

fn extension_dir_name(value: &str) -> Result<String, String> {
    let normalized = value
        .trim()
        .trim_start_matches('@')
        .replace(['/', '\\'], "-");
    safe_extension_part(&normalized)?;
    Ok(normalized)
}

fn installed_extension_path(root: &Path, extension_name: &str) -> Result<PathBuf, String> {
    let direct = root.join(extension_dir_name(extension_name)?);
    if direct.join("package.json").is_file() {
        return Ok(direct);
    }
    fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            fs::read_to_string(path.join(".qimao-source-name"))
                .ok()
                .is_some_and(|name| name.trim() == extension_name)
        })
        .ok_or_else(|| "未找到已安装扩展".into())
}

fn remove_extension_dir(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut last_error = None;
    for _ in 0..4 {
        match fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(90));
            }
        }
    }
    Err(last_error
        .map(|error| format!("删除扩展失败：{error}"))
        .unwrap_or_else(|| "删除扩展失败".into()))
}

#[tauri::command]
fn scan_extension_commands(app: tauri::AppHandle) -> Vec<ExtensionCommand> {
    extensions_dir(&app)
        .map(|root| scan_extension_commands_in(&root))
        .unwrap_or_default()
}

#[tauri::command]
async fn fetch_extension_catalog(query: String) -> Result<serde_json::Value, String> {
    let query = query.trim().to_lowercase();
    let endpoint = if query.is_empty() {
        "https://api.supercmd.sh/extensions/popular?limit=48"
    } else {
        "https://api.supercmd.sh/extensions/catalog"
    };
    let client = reqwest::Client::builder()
        .user_agent("Qimiao/0.9.1")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut catalog = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| format!("获取扩展目录失败：{e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<Vec<serde_json::Value>>()
        .await
        .map_err(|e| e.to_string())?;
    if !query.is_empty() {
        catalog.retain(|item| {
            ["title", "name", "description", "author", "owner"]
                .into_iter()
                .filter_map(|key| item.get(key).and_then(|value| value.as_str()))
                .any(|value| value.to_lowercase().contains(&query))
        });
    }
    catalog.truncate(48);
    Ok(serde_json::Value::Array(catalog))
}

#[tauri::command]
async fn install_extension(
    app: tauri::AppHandle,
    extension_name: String,
) -> Result<Vec<ExtensionCommand>, String> {
    let source_name = extension_name.trim().to_owned();
    if source_name.is_empty() {
        return Err("扩展标识无效".into());
    }
    let install_name = extension_dir_name(&source_name)?;
    let root = extensions_dir(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let endpoint = format!(
        "https://api.supercmd.sh/extensions/{}/bundle",
        urlencoding::encode(&source_name)
    );
    let client = reqwest::Client::builder()
        .user_agent("Qimiao/0.9.1")
        .build()
        .map_err(|e| e.to_string())?;
    let ticket: ExtensionBundleTicket = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| format!("获取扩展下载地址失败：{e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let archive = client
        .get(ticket.url)
        .send()
        .await
        .map_err(|e| format!("下载扩展失败：{e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let install_root = root.clone();
    let install_source_name = source_name.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let staging =
            install_root.join(format!(".install-{}-{}", install_name, std::process::id()));
        if staging.exists() {
            fs::remove_dir_all(&staging).map_err(|e| e.to_string())?
        }
        fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        let decoder = flate2::read::GzDecoder::new(archive.as_ref());
        let mut tar = tar::Archive::new(decoder);
        for item in tar.entries().map_err(|e| e.to_string())? {
            let mut entry = item.map_err(|e| e.to_string())?;
            if !entry.unpack_in(&staging).map_err(|e| e.to_string())? {
                return Err("扩展包包含不安全路径".into());
            }
        }
        let source = WalkDir::new(&staging)
            .max_depth(5)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_dir())
            .filter(|entry| entry.path().join("package.json").is_file())
            .min_by_key(|entry| entry.depth())
            .map(|entry| entry.into_path())
            .ok_or("扩展包中缺少 package.json")?;
        let raw_manifest = fs::read_to_string(source.join("package.json"))
            .map_err(|e| format!("读取扩展清单失败：{e}"))?;
        let manifest: serde_json::Value =
            serde_json::from_str(&raw_manifest).map_err(|e| format!("扩展清单无效：{e}"))?;
        let commands = manifest
            .get("commands")
            .and_then(|value| value.as_array())
            .ok_or("扩展清单中没有命令")?;
        let runnable = commands.iter().filter(|command| {
            let mode = command.get("mode").and_then(|value| value.as_str());
            let name = command.get("name").and_then(|value| value.as_str());
            mode != Some("menu-bar")
                && name.is_some_and(|name| {
                    source
                        .join(".sc-build")
                        .join(format!("{name}.js"))
                        .is_file()
                })
        });
        if runnable.count() == 0 {
            return Err("扩展包没有可在启喵中运行的预构建命令".into());
        }
        let target = install_root.join(&install_name);
        if target.exists() {
            remove_extension_dir(&target)?
        }
        fs::rename(source, &target).map_err(|e| e.to_string())?;
        fs::write(target.join(".qimao-source-name"), &install_source_name)
            .map_err(|e| e.to_string())?;
        let _ = fs::remove_dir_all(staging);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(scan_extension_commands_in(&root))
}

#[tauri::command]
async fn uninstall_extension(
    app: tauri::AppHandle,
    extension_name: String,
) -> Result<Vec<ExtensionCommand>, String> {
    let root = extensions_dir(&app)?;
    let target = installed_extension_path(&root, &extension_name)?;
    tauri::async_runtime::spawn_blocking(move || remove_extension_dir(&target))
        .await
        .map_err(|e| e.to_string())??;
    Ok(scan_extension_commands_in(&root))
}

#[tauri::command]
fn load_extension_command(
    app: tauri::AppHandle,
    extension_name: String,
    command_name: String,
) -> Result<ExtensionBundle, String> {
    let command_name = safe_extension_part(&command_name)?;
    let root = extensions_dir(&app)?;
    let dir = installed_extension_path(&root, &extension_name)?;
    let command = scan_extension_commands_in(&root)
        .into_iter()
        .find(|item| item.extension_name == extension_name && item.command_name == command_name)
        .ok_or("未找到扩展命令")?;
    let code = fs::read_to_string(dir.join(".sc-build").join(format!("{command_name}.js")))
        .map_err(|e| format!("读取扩展构建文件失败：{e}"))?;
    let assets_dir = dir.join("assets");
    let mut assets = Vec::new();
    if assets_dir.exists() {
        for item in WalkDir::new(&assets_dir)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
        {
            let path = item.path();
            let Ok(relative) = path.strip_prefix(&assets_dir) else {
                continue;
            };
            let Ok(data) = fs::read(path) else { continue };
            if data.len() > 8 * 1024 * 1024 {
                continue;
            }
            assets.push(ExtensionAsset {
                path: relative.to_string_lossy().replace('\\', "/"),
                data: STANDARD.encode(data),
            })
        }
    }
    Ok(ExtensionBundle {
        command,
        code,
        assets,
        extension_path: dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    app.tray_by_id("main-tray")
        .ok_or("未找到菜单栏图标")?
        .set_visible(visible)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_auto_start(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|e| e.to_string())?;
    manager.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_auto_start(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_material(
    window: tauri::WebviewWindow,
    material: String,
    dark: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::window::{Color, Effect, EffectsBuilder};
        if material == "solid" {
            window.set_effects(None).map_err(|e| e.to_string())?;
        } else {
            let color = if dark {
                Color(50, 59, 78, if material == "glass" { 120 } else { 88 })
            } else {
                Color(238, 244, 252, if material == "glass" { 112 } else { 76 })
            };
            window
                .set_effects(
                    EffectsBuilder::new()
                        .effect(Effect::Acrylic)
                        .color(color)
                        .build(),
                )
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSGlassEffectView, NSGlassEffectViewStyle, NSWindow};
        let ns_window =
            unsafe { &*(window.ns_window().map_err(|e| e.to_string())? as *const NSWindow) };
        if let Some(content) = ns_window.contentView() {
            if let Some(glass) = content.downcast_ref::<NSGlassEffectView>() {
                glass.setStyle(if material == "liquid" {
                    NSGlassEffectViewStyle::Clear
                } else {
                    NSGlassEffectViewStyle::Regular
                });
            }
        }
        let _ = dark;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (window, material, dark);
    }
    Ok(())
}

#[tauri::command]
fn read_icon(path: String) -> Result<String, String> {
    if !path.contains("miaoqi-icons") && !path.contains("miaoqi-quicklook") {
        return Err("拒绝读取非图标缓存路径".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
async fn load_app_icon(path: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app = PathBuf::from(&path);
        #[cfg(target_os = "macos")]
        let valid = app
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("app"));
        #[cfg(target_os = "windows")]
        let valid = app.extension().is_some_and(|e| {
            matches!(
                e.to_string_lossy().to_ascii_lowercase().as_str(),
                "exe" | "lnk"
            )
        });
        #[cfg(target_os = "linux")]
        let valid = app
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("desktop"));
        if !app.exists() || !valid {
            return Err("无效的应用路径".into());
        }
        let icon = app_icon(&app, &name);
        if icon.contains('|') {
            Err("未找到应用图标".into())
        } else {
            Ok(icon)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_macos_permission(kind: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let pane = if kind == "accessibility" {
            "Privacy_Accessibility"
        } else {
            "Privacy_ListenEvent"
        };
        Command::new("open")
            .arg(format!(
                "x-apple.systempreferences:com.apple.preference.security?{pane}"
            ))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = kind;
        Err("此设置仅适用于 macOS".into())
    }
}

fn shortcut_from_text(accelerator: &str) -> Result<Shortcut, String> {
    if accelerator == "DoubleControl" {
        Ok(Shortcut::new(None, Code::ControlLeft))
    } else {
        accelerator.parse().map_err(|e| format!("无效快捷键: {e}"))
    }
}

#[cfg(target_os = "windows")]
fn set_windows_rounded_region(hwnd: isize, size: tauri::PhysicalSize<u32>, scale: f64) {
    type NativeHandle = isize;
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRoundRectRgn(
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
            width: i32,
            height: i32,
        ) -> NativeHandle;
        fn DeleteObject(object: NativeHandle) -> i32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowRgn(window: NativeHandle, region: NativeHandle, redraw: i32) -> i32;
    }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            window: NativeHandle,
            attribute: u32,
            value: *const std::ffi::c_void,
            size: u32,
        ) -> i32;
    }

    let diameter = (52.0 * scale).round().max(2.0) as i32;
    // DWMWA_WINDOW_CORNER_PREFERENCE / DWMWCP_ROUND. The window region below
    // is the important part for transparent, borderless WebView2 windows; it
    // physically clips the compositor surface so no square pixels can leak.
    let preference: u32 = 2;
    let color_none: u32 = 0xffff_fffe;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            33,
            (&preference as *const u32).cast(),
            std::mem::size_of_val(&preference) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            34,
            (&color_none as *const u32).cast(),
            std::mem::size_of_val(&color_none) as u32,
        );
        let region = CreateRoundRectRgn(
            0,
            0,
            size.width.saturating_add(1) as i32,
            size.height.saturating_add(1) as i32,
            diameter,
            diameter,
        );
        if region != 0 && SetWindowRgn(hwnd, region, 1) == 0 {
            let _ = DeleteObject(region);
        }
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_rounded_region(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    set_windows_rounded_region(
        window.hwnd()?.0 as isize,
        window.outer_size()?,
        window.scale_factor().unwrap_or(1.0),
    );
    Ok(())
}

#[cfg(target_os = "windows")]
fn refresh_windows_rounded_region(window: &tauri::Window) -> tauri::Result<()> {
    set_windows_rounded_region(
        window.hwnd()?.0 as isize,
        window.outer_size()?,
        window.scale_factor().unwrap_or(1.0),
    );
    Ok(())
}

#[tauri::command]
fn set_global_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<ShortcutRuntime>,
    accelerator: String,
    previous_accelerator: Option<String>,
) -> Result<(), String> {
    let shortcut = shortcut_from_text(&accelerator)?;
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    if let Err(error) = app.global_shortcut().register(shortcut) {
        if let Some(previous) = previous_accelerator
            .as_deref()
            .and_then(|s| shortcut_from_text(s).ok())
        {
            let _ = app.global_shortcut().register(previous);
        }
        return Err(format!("系统无法注册此快捷键：{error}"));
    }
    state
        .double_control
        .store(accelerator == "DoubleControl", Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn suspend_global_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())
}

fn position_launcher(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let area = monitor.size();
    let origin = monitor.position();
    let x = origin.x + (area.width.saturating_sub(size.width) / 2) as i32;
    let y = origin.y + ((area.height.saturating_sub(size.height)) as f64 * 0.58) as i32;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

fn show_launcher(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        position_launcher(&w);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit("launcher-shown", ());
    }
}

fn toggle_launcher(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_launcher(app)
        }
    }
}

#[cfg(target_os = "macos")]
fn apply_native_glass(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use objc2::{runtime::AnyClass, MainThreadMarker};
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSColor, NSGlassEffectView, NSGlassEffectViewStyle, NSWindow,
    };
    use std::ffi::CStr;
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    let class_name = CStr::from_bytes_with_nul(b"NSGlassEffectView\0").expect("valid class name");
    let Some(mtm) = MainThreadMarker::new() else {
        return Ok(());
    };
    if AnyClass::get(class_name).is_none() {
        return window.set_effects(
            EffectsBuilder::new()
                .effect(Effect::Popover)
                .state(EffectState::Active)
                .radius(26.0)
                .build(),
        );
    }
    let ns_window = unsafe { &*(window.ns_window()? as *const NSWindow) };
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    if let Some(content) = ns_window.contentView() {
        let glass = NSGlassEffectView::initWithFrame(mtm.alloc(), content.frame());
        glass.setStyle(NSGlassEffectViewStyle::Clear);
        glass.setTintColor(None);
        glass.setCornerRadius(26.0);
        glass.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        glass.setContentView(Some(&content));
        ns_window.setContentView(Some(&glass));
    }
    Ok(())
}

fn colorful_tray_icon() -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/tray-cat.png"))
}

pub fn run() {
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    tauri::Builder::default()
        .manage(ShortcutRuntime::default())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("启喵")
                .arg("--autostart")
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        let runtime = app.state::<ShortcutRuntime>();
                        if runtime.double_control.load(Ordering::Relaxed) {
                            let Ok(mut last) = runtime.last_control.lock() else {
                                return;
                            };
                            let now = Instant::now();
                            if !last.is_some_and(|previous| {
                                now.duration_since(previous) < Duration::from_millis(430)
                            }) {
                                *last = Some(now);
                                return;
                            }
                            *last = None;
                        }
                        toggle_launcher(app)
                    }
                })
                .build(),
        )
        .setup(move |app| {
            app.global_shortcut().register(shortcut)?;
            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory)?;
            let show = MenuItemBuilder::with_id("show", "显示启喵").build(app)?;
            let settings = MenuItemBuilder::with_id("settings", "设置…").build(app)?;
            let update = MenuItemBuilder::with_id("check_update", "检查更新…").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出启喵").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &settings, &update, &quit])
                .build()?;
            let tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("启喵")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .icon(colorful_tray_icon()?)
                .icon_as_template(false);
            tray.on_tray_icon_event(|tray, event| {
                if matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                ) {
                    toggle_launcher(tray.app_handle())
                }
            })
            .build(app)?;
            if let Some(w) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    let _ = w.set_shadow(false);
                    let _ = w.set_resizable(false);
                    let _ = w.set_min_size(Some(tauri::LogicalSize::new(770.0, 524.0)));
                    let _ = w.set_size(tauri::LogicalSize::new(957.0, 614.0));
                    let _ = apply_windows_rounded_region(&w);
                }
                position_launcher(&w);
                #[cfg(target_os = "macos")]
                apply_native_glass(&w)?;
                if std::env::args().any(|arg| arg == "--autostart") {
                    let _ = w.hide();
                } else {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_launcher(app),
            "settings" => {
                show_launcher(app);
                let _ = app.emit("navigate-settings", ());
            }
            "check_update" => {
                show_launcher(app);
                let _ = app.emit("check-update", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            if matches!(event, tauri::WindowEvent::Resized(_)) {
                let _ = refresh_windows_rounded_region(window);
            }
            if matches!(event, tauri::WindowEvent::Focused(false)) {
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan_apps,
            launch_app,
            choose_folder,
            choose_app,
            open_plugin_directory,
            clipboard_text,
            open_external_url,
            set_tray_visible,
            set_auto_start,
            get_auto_start,
            set_window_material,
            read_icon,
            load_app_icon,
            open_macos_permission,
            set_global_shortcut,
            suspend_global_shortcuts,
            scan_extension_commands,
            fetch_extension_catalog,
            install_extension,
            uninstall_extension,
            load_extension_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running Qimiao");
}

#[cfg(test)]
mod extension_storage_tests {
    use super::*;

    fn fixture_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "qimao-extension-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ))
    }

    #[test]
    fn scans_runnable_commands_and_removes_scoped_extension() {
        let root = fixture_root();
        let extension = root.join("owner-emoji");
        fs::create_dir_all(extension.join(".sc-build")).unwrap();
        fs::write(extension.join(".qimao-source-name"), "@owner/emoji").unwrap();
        fs::write(
            extension.join("package.json"),
            r#"{
              "title":"Emoji",
              "commands":[
                {"name":"search","title":"Search","mode":"view"},
                {"name":"tray","title":"Tray","mode":"menu-bar"},
                {"name":"missing","title":"Missing","mode":"view"}
              ]
            }"#,
        )
        .unwrap();
        fs::write(
            extension.join(".sc-build/search.js"),
            "module.exports = () => null;",
        )
        .unwrap();

        let commands = scan_extension_commands_in(&root);
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].extension_name, "@owner/emoji");
        assert_eq!(commands[0].command_name, "search");
        assert_eq!(
            installed_extension_path(&root, "@owner/emoji").unwrap(),
            extension
        );
        remove_extension_dir(&extension).unwrap();
        assert!(!extension.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_windows_uninstall_and_maintenance_entries() {
        for path in [
            "C:/Start Menu/Uninstall IDM.lnk",
            "C:/Start Menu/卸载微信.lnk",
            "C:/Program Files/App/unins000.exe",
            "C:/Program Files/App/Updater.exe",
        ] {
            assert!(looks_like_windows_non_app(Path::new(path)), "{path}");
        }
    }

    #[test]
    fn keeps_real_windows_app_entries() {
        for path in [
            "C:/Start Menu/Postman.lnk",
            "C:/Start Menu/微信.lnk",
            "C:/Program Files/App/Postman.exe",
        ] {
            assert!(!looks_like_windows_non_app(Path::new(path)), "{path}");
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn extracts_real_png_icon() {
        let path = Path::new("/Applications/HandBrake.app");
        if path.exists() {
            let icon = app_icon(path, "HandBrake");
            assert!(icon.starts_with("data:image/png;base64,"));
            let bytes = STANDARD
                .decode(icon.trim_start_matches("data:image/png;base64,"))
                .unwrap();
            assert_eq!(&bytes[..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
        }
    }
    #[test]
    fn parses_shortcut_presets() {
        for value in [
            "Alt+Space",
            "CommandOrControl+Space",
            "CommandOrControl+Shift+Space",
            "Alt+Shift+Space",
        ] {
            assert!(value.parse::<Shortcut>().is_ok(), "{value}");
        }
    }
    #[test]
    fn scans_raycast_format_extension_from_qimao_directory() {
        let root = std::env::temp_dir().join(format!(
            "qimao-extension-test-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("scan")
        ));
        let extension = root.join("hello-world");
        fs::create_dir_all(extension.join(".sc-build")).unwrap();
        fs::write(
            extension.join("package.json"),
            r#"{"name":"@community/hello-world","title":"Hello World","author":"Qimiao","commands":[{"name":"hello","title":"Hello","description":"A real Raycast-format command","mode":"view"}]}"#,
        )
        .unwrap();
        fs::write(
            extension.join(".sc-build/hello.js"),
            "module.exports.default = function Hello() {};",
        )
        .unwrap();
        let commands = scan_extension_commands_in(&root);
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].extension_name, "hello-world");
        assert_eq!(commands[0].command_name, "hello");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn scan_returns_lazy_icon_markers() {
        let apps = scan_apps_blocking(vec![]);
        assert!(!apps.is_empty());
        assert!(apps.iter().all(|app| app
            .icon
            .as_deref()
            .is_some_and(|icon| icon.starts_with("app:"))));
    }
    #[test]
    fn extracts_ios_appstore_icon() {
        let path = Path::new("/Applications/Video Reverser.app");
        if path.exists() {
            let icon = app_icon(path, "Video Reverser");
            assert!(icon.starts_with("data:image/png;base64,"));
            let bytes = STANDARD
                .decode(icon.trim_start_matches("data:image/png;base64,"))
                .unwrap();
            let decoded = image::load_from_memory(&bytes).unwrap();
            assert_eq!(decoded.width(), 160);
            assert_eq!(decoded.height(), 160);
        }
    }
    #[test]
    fn extracts_wrapped_ios_icon_without_disabled_badge() {
        let path = Path::new("/Applications/Xiaomi Home.app");
        if path.exists() {
            let icon = ios_wrapped_icon(path).expect("应从 Wrapper 中提取原始 AppIcon");
            let bytes = STANDARD
                .decode(icon.trim_start_matches("data:image/png;base64,"))
                .unwrap();
            let decoded = image::load_from_memory(&bytes).unwrap();
            assert_eq!(decoded.width(), 160);
            assert_eq!(decoded.height(), 160);
        }
    }
    #[test]
    fn extracts_books_icon() {
        let path = Path::new("/System/Applications/Books.app");
        if path.exists() {
            let icon = app_icon(path, "Books");
            assert!(icon.starts_with("data:image/png;base64,"));
        }
    }
}
