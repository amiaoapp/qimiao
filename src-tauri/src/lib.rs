use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
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
mod clipboard;
mod fonts;
mod webdav;
mod tool_windows;
#[cfg(target_os = "macos")]
mod macos_tools;

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
    app_category: Option<String>,
    installed_at: Option<u64>,
    launch_count: u32,
    favorite: bool,
    manual: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSearchResult {
    name: String,
    path: String,
    is_dir: bool,
}
#[cfg(any())]
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
#[cfg(any())]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionAsset {
    path: String,
    data: String,
}
#[cfg(any())]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionBundle {
    command: ExtensionCommand,
    code: String,
    assets: Vec<ExtensionAsset>,
    extension_path: String,
}
#[cfg(any())]
#[derive(Debug, serde::Deserialize)]
struct ExtensionBundleTicket {
    url: String,
}
struct ShortcutRuntime {
    bindings: Mutex<Vec<(Shortcut, String, bool)>>,
    last_control: Mutex<Option<Instant>>,
    pressed: Mutex<HashSet<u32>>,
}

struct WindowRuntime {
    native_dialog_open: AtomicBool,
    ignore_blur_until: Mutex<Option<Instant>>,
}
impl Default for WindowRuntime {
    fn default() -> Self {
        Self {
            native_dialog_open: AtomicBool::new(false),
            ignore_blur_until: Mutex::new(None),
        }
    }
}
impl WindowRuntime {
    fn protect_focus(&self, duration: Duration) {
        if let Ok(mut until) = self.ignore_blur_until.lock() {
            *until = Some(Instant::now() + duration);
        }
    }
    fn should_hide(&self) -> bool {
        if self.native_dialog_open.load(Ordering::SeqCst) {
            return false;
        }
        self.ignore_blur_until
            .lock()
            .map(|until| !until.is_some_and(|deadline| Instant::now() < deadline))
            .unwrap_or(true)
    }
}
impl Default for ShortcutRuntime {
    fn default() -> Self {
        Self {
            bindings: Mutex::new(Vec::new()),
            last_control: Mutex::new(None),
            pressed: Mutex::new(HashSet::new()),
        }
    }
}

#[cfg(not(target_os = "windows"))]
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
#[allow(dead_code)]
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
    .any(|word| compact.contains(word));
    let system_tool = [
        "administrativetools",
        "charactermap",
        "commandprompt",
        "componentservices",
        "computermanagement",
        "onscreenkeyboard",
        "performancemonitor",
        "recoverydrive",
        "registryeditor",
        "resourcemonitor",
        "run",
        "services",
        "stepsrecorder",
        "systemconfiguration",
        "systeminformation",
        "taskscheduler",
        "taskmanager",
        "windowspowershell",
        "windowsdefender",
        "windowsmediaplayer",
    ]
    .contains(&compact.as_str());
    let system_tool_directory = path.ancestors().skip(1).any(|parent| {
        parent.file_name().is_some_and(|value| {
            matches!(
                value.to_string_lossy().to_lowercase().as_str(),
                "administrative tools" | "windows tools" | "system tools"
            )
        })
    });
    let uninstall_directory = path.ancestors().skip(1).any(|parent| {
        parent
            .file_name()
            .map(|value| value.to_string_lossy().to_lowercase())
            .is_some_and(|value| value == "uninstall" || value == "uninstaller" || value == "卸载")
    });
    obvious_action || uninstall_directory || system_tool || system_tool_directory
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

#[cfg(not(target_os = "windows"))]
fn normalize_rgba_icon(source: image::RgbaImage) -> image::RgbaImage {
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
        return source;
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
    canvas
}

// Windows applications ship arbitrary silhouettes and transparent padding.
// Give all of them one optical size inside the same rounded system tile.
#[cfg(any(target_os = "windows", test))]
fn windows_icon_bounds(source: &image::RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let (w, h) = source.dimensions();
    if w == 0 || h == 0 {
        return None;
    }
    // Some PE/shortcut icons contain an opaque neutral canvas, others a faint
    // full-size shadow. Neither should determine the visible glyph's size.
    let corners = [
        source.get_pixel(0, 0),
        source.get_pixel(w - 1, 0),
        source.get_pixel(0, h - 1),
        source.get_pixel(w - 1, h - 1),
    ];
    let neutral_canvas = corners.iter().all(|p| {
        p[3] > 240
            && p[0] > 224
            && p[1] > 224
            && p[2] > 224
            && p[0].abs_diff(p[1]) < 16
            && p[1].abs_diff(p[2]) < 16
    });
    let mut bounds = (w, h, 0, 0);
    let mut found = false;
    for (x, y, pixel) in source.enumerate_pixels() {
        let background = neutral_canvas
            && pixel[0] > 224
            && pixel[1] > 224
            && pixel[2] > 224
            && pixel[0].abs_diff(pixel[1]) < 16
            && pixel[1].abs_diff(pixel[2]) < 16;
        if pixel[3] >= 96 && !background {
            found = true;
            bounds.0 = bounds.0.min(x);
            bounds.1 = bounds.1.min(y);
            bounds.2 = bounds.2.max(x);
            bounds.3 = bounds.3.max(y);
        }
    }
    if !found {
        return None;
    }
    if neutral_canvas {
        let padding = ((bounds.2 - bounds.0 + 1).max(bounds.3 - bounds.1 + 1) / 16).max(1);
        bounds = (
            bounds.0.saturating_sub(padding),
            bounds.1.saturating_sub(padding),
            (bounds.2 + padding).min(w - 1),
            (bounds.3 + padding).min(h - 1),
        );
    }
    Some(bounds)
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_icon(source: image::RgbaImage) -> image::RgbaImage {
    let mut canvas = image::RgbaImage::new(160, 160);
    // Signed-distance coverage keeps corners smooth at both 1x and 2x.
    for (x, y, pixel) in canvas.enumerate_pixels_mut() {
        let dx = ((x as f32 + 0.5 - 80.0).abs() - 42.0).max(0.0);
        let dy = ((y as f32 + 0.5 - 80.0).abs() - 42.0).max(0.0);
        let alpha = ((30.0 - (dx * dx + dy * dy).sqrt() + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
        let tone = (251.0 - y as f32 / 160.0 * 13.0).round() as u8;
        *pixel = image::Rgba([tone, tone, tone.saturating_add(2), alpha]);
    }
    if let Some(bounds) = windows_icon_bounds(&source) {
        let crop = image::imageops::crop_imm(
            &source,
            bounds.0,
            bounds.1,
            bounds.2 - bounds.0 + 1,
            bounds.3 - bounds.1 + 1,
        )
        .to_image();
        let scale = 132.0 / crop.width().max(crop.height()) as f32;
        let nw = (crop.width() as f32 * scale).round().max(1.0) as u32;
        let nh = (crop.height() as f32 * scale).round().max(1.0) as u32;
        let resized = image::imageops::resize(&crop, nw, nh, image::imageops::FilterType::Lanczos3);
        image::imageops::overlay(
            &mut canvas,
            &resized,
            ((160 - nw) / 2) as i64,
            ((160 - nh) / 2) as i64,
        );
    }
    canvas
}

#[cfg(target_os = "macos")]
fn normalize_icon(path: &Path) {
    let Ok(source) = image::open(path).map(|i| i.to_rgba8()) else {
        return;
    };
    let _ = normalize_rgba_icon(source).save(path);
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
                "windows-icon-actual-bitmap-v5:{}:{}:{}",
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
    windows_shell_icon(path)
        .map(normalize_windows_icon)
        .and_then(|image| image.save(&output_path).ok().map(|_| image))
        .and_then(|_| fs::read(&output_path).ok())
        .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
        .unwrap_or_else(|| color_for(name))
}

#[cfg(target_os = "windows")]
fn windows_shell_icon(path: &Path) -> Option<image::RgbaImage> {
    let visible = |icon: &image::RgbaImage| icon.pixels().any(|pixel| pixel[3] >= 48);
    windows_shell_thumbnail(path)
        .filter(visible)
        .or_else(|| windows_legacy_shell_icon(path).filter(visible))
}

#[cfg(target_os = "windows")]
fn windows_shell_thumbnail(path: &Path) -> Option<image::RgbaImage> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::SIZE,
            Graphics::Gdi::{
                CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP,
                BITMAPINFO, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
            },
            System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
            UI::Shell::{
                IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
                SIIGBF_ICONONLY,
            },
        },
    };

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
    let image = (|| {
        let factory: IShellItemImageFactory =
            unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()? };
        const SIDE: i32 = 160;
        let bitmap = unsafe {
            factory
                .GetImage(
                    SIZE { cx: SIDE, cy: SIDE },
                    SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
                )
                .ok()?
        };
        if bitmap.0.is_null() {
            return None;
        }
        let mut actual = BITMAP::default();
        let queried = unsafe {
            GetObjectW(
                HGDIOBJ(bitmap.0),
                std::mem::size_of::<BITMAP>() as i32,
                Some((&mut actual as *mut BITMAP).cast()),
            )
        };
        let width = actual.bmWidth;
        let height = actual.bmHeight.unsigned_abs();
        if queried == 0 || width <= 0 || height == 0 || width > 4096 || height > 4096 {
            let _ = unsafe { DeleteObject(HGDIOBJ(bitmap.0)) };
            return None;
        }
        let mut bitmap_info = BITMAPINFO::default();
        bitmap_info.bmiHeader.biSize = std::mem::size_of_val(&bitmap_info.bmiHeader) as u32;
        bitmap_info.bmiHeader.biWidth = width;
        bitmap_info.bmiHeader.biHeight = -(height as i32);
        bitmap_info.bmiHeader.biPlanes = 1;
        bitmap_info.bmiHeader.biBitCount = 32;
        bitmap_info.bmiHeader.biCompression = BI_RGB.0;
        let mut bgra = vec![0u8; width as usize * height as usize * 4];
        let dc = unsafe { CreateCompatibleDC(None) };
        let copied = if dc.0.is_null() {
            0
        } else {
            unsafe {
                GetDIBits(
                    dc,
                    bitmap,
                    0,
                    height,
                    Some(bgra.as_mut_ptr().cast()),
                    &mut bitmap_info,
                    DIB_RGB_COLORS,
                )
            }
        };
        if !dc.0.is_null() {
            let _ = unsafe { DeleteDC(dc) };
        }
        let _ = unsafe { DeleteObject(HGDIOBJ(bitmap.0)) };
        if copied != height as i32 {
            return None;
        }
        let has_alpha = bgra.chunks_exact(4).any(|pixel| pixel[3] != 0);
        let mut rgba = Vec::with_capacity(bgra.len());
        for pixel in bgra.chunks_exact(4) {
            let alpha = if has_alpha {
                pixel[3]
            } else if pixel[0] | pixel[1] | pixel[2] != 0 {
                255
            } else {
                0
            };
            let unpremultiply = |channel: u8| -> u8 {
                if alpha > 0 && alpha < 255 {
                    ((u16::from(channel) * 255 / u16::from(alpha)).min(255)) as u8
                } else {
                    channel
                }
            };
            rgba.extend_from_slice(&[
                unpremultiply(pixel[2]),
                unpremultiply(pixel[1]),
                unpremultiply(pixel[0]),
                alpha,
            ]);
        }
        image::RgbaImage::from_raw(width as u32, height, rgba)
    })();
    if initialized {
        unsafe { CoUninitialize() };
    }
    image
}

#[cfg(target_os = "windows")]
fn windows_legacy_shell_icon(path: &Path) -> Option<image::RgbaImage> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::HANDLE,
        Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
            BI_RGB, DIB_RGB_COLORS,
        },
        UI::{
            Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON},
            WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL},
        },
    };

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut info = SHFILEINFOW::default();
    let found = unsafe {
        SHGetFileInfoW(
            wide.as_ptr(),
            0,
            &mut info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if found == 0 || info.hIcon.is_null() {
        return None;
    }

    const SIDE: i32 = 128;
    let mut bitmap_info = BITMAPINFO::default();
    bitmap_info.bmiHeader.biSize = std::mem::size_of_val(&bitmap_info.bmiHeader) as u32;
    bitmap_info.bmiHeader.biWidth = SIDE;
    bitmap_info.bmiHeader.biHeight = -SIDE;
    bitmap_info.bmiHeader.biPlanes = 1;
    bitmap_info.bmiHeader.biBitCount = 32;
    bitmap_info.bmiHeader.biCompression = BI_RGB;
    let mut pixels: *mut c_void = ptr::null_mut();
    let dc = unsafe { CreateCompatibleDC(ptr::null_mut()) };
    if dc.is_null() {
        unsafe { DestroyIcon(info.hIcon) };
        return None;
    }
    let bitmap = unsafe {
        CreateDIBSection(
            dc,
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut pixels,
            ptr::null_mut::<c_void>() as HANDLE,
            0,
        )
    };
    if bitmap.is_null() || pixels.is_null() {
        unsafe {
            DeleteDC(dc);
            DestroyIcon(info.hIcon);
        }
        return None;
    }
    let old = unsafe { SelectObject(dc, bitmap) };
    unsafe {
        std::ptr::write_bytes(pixels.cast::<u8>(), 0, (SIDE * SIDE * 4) as usize);
    }
    let drawn = unsafe {
        DrawIconEx(
            dc,
            0,
            0,
            info.hIcon,
            SIDE,
            SIDE,
            0,
            ptr::null_mut(),
            DI_NORMAL,
        )
    };
    let byte_count = (SIDE * SIDE * 4) as usize;
    let bgra = unsafe { std::slice::from_raw_parts(pixels.cast::<u8>(), byte_count) };
    let has_alpha = bgra.chunks_exact(4).any(|pixel| pixel[3] != 0);
    let mut rgba = Vec::with_capacity(byte_count);
    for pixel in bgra.chunks_exact(4) {
        rgba.extend_from_slice(&[
            pixel[2],
            pixel[1],
            pixel[0],
            if has_alpha {
                pixel[3]
            } else if pixel[0] | pixel[1] | pixel[2] != 0 {
                255
            } else {
                0
            },
        ]);
    }
    unsafe {
        SelectObject(dc, old);
        DeleteObject(bitmap);
        DeleteDC(dc);
        DestroyIcon(info.hIcon);
    }
    if drawn == 0 {
        return None;
    }
    image::RgbaImage::from_raw(SIDE as u32, SIDE as u32, rgba)
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
    #[cfg(target_os = "windows")]
    {
        let _ = extra_dirs;
        return Vec::new();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut roots = default_dirs();
        roots.extend(extra_dirs.into_iter().map(PathBuf::from));
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        for root in roots {
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
    let app_category = plist::Value::from_file(path.join("Contents/Info.plist"))
        .ok()
        .and_then(|value| value.into_dictionary())
        .and_then(|dictionary| {
            dictionary
                .get("LSApplicationCategoryType")
                .and_then(|value| value.as_string())
                .map(str::to_owned)
        });
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
        app_category,
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
fn existing_app_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|value| {
            let path = Path::new(value);
            path.exists() && is_app(path)
        })
        .collect()
}

#[tauri::command]
async fn launch_app(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let result = tauri::async_runtime::spawn_blocking(move || launch_path(path))
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
    if result.is_err() {
        show_launcher(&app);
    }
    result
}

fn launch_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&path);
        c
    };
    #[cfg(target_os = "windows")]
    {
        use std::{os::windows::ffi::OsStrExt, ptr};
        use windows::Win32::System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
        };
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
        let wide: Vec<u16> = std::ffi::OsStr::new(&path)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                ptr::null_mut(),
                ptr::null(),
                wide.as_ptr(),
                ptr::null(),
                ptr::null(),
                SW_SHOWNORMAL,
            )
        } as isize;
        if initialized {
            unsafe { CoUninitialize() };
        }
        return if result > 32 {
            Ok(())
        } else {
            Err(format!("Windows 无法启动此应用（错误 {result}）"))
        };
    }
    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = Command::new("gtk-launch");
        c.arg(Path::new(&path).file_stem().unwrap_or_default());
        c
    };
    #[cfg(not(target_os = "windows"))]
    {
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn choose_folder(state: tauri::State<WindowRuntime>) -> Option<String> {
    state.native_dialog_open.store(true, Ordering::SeqCst);
    let selected = rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string());
    state.native_dialog_open.store(false, Ordering::SeqCst);
    state.protect_focus(Duration::from_millis(800));
    selected
}

#[tauri::command]
fn export_backup(
    state: tauri::State<WindowRuntime>,
    contents: String,
) -> Result<Option<String>, String> {
    state.native_dialog_open.store(true, Ordering::SeqCst);
    let selected = rfd::FileDialog::new()
        .add_filter("启喵 / qimiao JSON", &["json"])
        .set_file_name("启喵备份.json")
        .save_file();
    state.native_dialog_open.store(false, Ordering::SeqCst);
    state.protect_focus(Duration::from_millis(900));
    let Some(path) = selected else {
        return Ok(None);
    };
    fs::write(&path, contents).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn import_backup(state: tauri::State<WindowRuntime>) -> Result<Option<String>, String> {
    state.native_dialog_open.store(true, Ordering::SeqCst);
    let selected = rfd::FileDialog::new()
        .add_filter("启喵、TinyCast 或 Raycast", &["json", "tinycast"])
        .pick_file();
    state.native_dialog_open.store(false, Ordering::SeqCst);
    state.protect_focus(Duration::from_millis(900));
    selected.map(read_compatible_backup).transpose()
}

fn read_compatible_backup(path: PathBuf) -> Result<String, String> {
    if path.extension().and_then(|value| value.to_str()) != Some("tinycast") {
        return fs::read_to_string(path).map_err(|error| error.to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return read_tinycast_archive(&path);
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("TinyCast .tinycast archives can currently be imported on macOS. Export JSON data for cross-platform migration.".into())
    }
}

#[cfg(target_os = "macos")]
fn read_tinycast_archive(path: &Path) -> Result<String, String> {
    validate_tinycast_archive(path)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let staging = std::env::temp_dir().join(format!("qimiao-tinycast-import-{stamp}"));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let status = Command::new("/usr/bin/aa")
        .args(["extract", "-i"])
        .arg(path)
        .args(["-d"])
        .arg(&staging)
        .args([
            "-include-path",
            "manifest.json",
            "-include-path",
            "settings.json",
            "-include-path",
            "snippets",
            "-include-path",
            "notes",
            "-include-path",
            "clipboard/items.jsonl",
            "-exclude-type",
            "l",
        ])
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        let _ = fs::remove_dir_all(&staging);
        return Err("TinyCast archive could not be extracted".into());
    }
    let result = (|| {
        let settings_path = staging.join("settings.json");
        let settings: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&settings_path)
                .map_err(|_| "TinyCast archive has no readable settings.json")?,
        )
        .map_err(|error| format!("TinyCast settings are invalid: {error}"))?;
        let snippets = read_tinycast_markdown(&staging.join("snippets"), true)?;
        let notes = read_tinycast_markdown(&staging.join("notes"), false)?;
        let clipboard_entries = read_tinycast_clipboard(&staging.join("clipboard/items.jsonl"))?;
        serde_json::to_string(&serde_json::json!({
            "format": "tinycast-extracted",
            "settings": settings,
            "snippets": snippets,
            "notes": notes,
            "clipboardEntries": clipboard_entries,
        }))
        .map_err(|error| error.to_string())
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

#[cfg(target_os = "macos")]
fn validate_tinycast_archive(path: &Path) -> Result<(), String> {
    let output = Command::new("/usr/bin/aa")
        .args(["list", "-i"])
        .arg(path)
        .args(["-list-format", "json"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("TinyCast archive cannot be listed".into());
    }
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("TinyCast archive index is invalid: {error}"))?;
    for entry in entries {
        let kind = entry
            .get("TYP")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let path = entry
            .get("PAT")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if !matches!(kind, "F" | "D") {
            return Err("TinyCast archive contains an unsupported link or special entry".into());
        }
        let candidate = Path::new(path);
        if candidate.is_absolute()
            || candidate.components().any(|part| {
                matches!(
                    part,
                    std::path::Component::ParentDir
                        | std::path::Component::RootDir
                        | std::path::Component::Prefix(_)
                )
            })
        {
            return Err("TinyCast archive contains an unsafe path".into());
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn read_tinycast_clipboard(path: &Path) -> Result<Vec<String>, String> {
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(source
        .lines()
        .filter_map(|line| {
            let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
            if value.get("kind")?.as_str()? != "text" {
                return None;
            }
            value
                .get("text")?
                .as_str()
                .filter(|text| !text.is_empty())
                .map(str::to_string)
        })
        .take(100)
        .collect())
}

#[cfg(target_os = "macos")]
fn read_tinycast_markdown(dir: &Path, snippets: bool) -> Result<Vec<serde_json::Value>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut values = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.file_type().is_file()
            || path.extension().and_then(|value| value.to_str()) != Some("md")
        {
            continue;
        }
        let source = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let fallback = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Untitled")
            .replace('-', " ");
        if snippets {
            let (meta, text) = parse_tinycast_snippet(&source);
            values.push(serde_json::json!({
                "name": meta.get("name").and_then(|value| value.as_str()).unwrap_or(&fallback),
                "text": text,
                "keyword": meta.get("keyword").and_then(|value| value.as_str()),
                "isEnabled": meta.get("enabled").and_then(|value| value.as_bool()).unwrap_or(true),
                "showsConfirmation": meta.get("show_confirmation").and_then(|value| value.as_bool()).unwrap_or(false),
            }));
        } else {
            values.push(serde_json::json!({ "title": fallback, "content": source }));
        }
    }
    Ok(values)
}

#[cfg(target_os = "macos")]
fn parse_tinycast_snippet(source: &str) -> (serde_json::Map<String, serde_json::Value>, String) {
    let mut metadata = serde_json::Map::new();
    let mut lines = source.split_inclusive('\n');
    if lines.next().map(|line| line.trim_end_matches(['\r', '\n'])) != Some("---") {
        return (metadata, source.to_string());
    }
    let mut consumed = source
        .find('\n')
        .map(|index| index + 1)
        .unwrap_or(source.len());
    let mut found_end = false;
    for line in lines {
        consumed += line.len();
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" {
            found_end = true;
            break;
        }
        if let Some((key, raw)) = trimmed.split_once(':') {
            let key = key.trim();
            let raw = raw.trim();
            if matches!(key, "name" | "keyword") {
                if let Ok(value) = serde_json::from_str::<String>(raw) {
                    metadata.insert(key.into(), serde_json::Value::String(value));
                }
            } else if matches!(key, "enabled" | "show_confirmation") {
                if let Ok(value) = raw.parse::<bool>() {
                    metadata.insert(key.into(), serde_json::Value::Bool(value));
                }
            }
        }
    }
    if found_end {
        (metadata, source[consumed..].to_string())
    } else {
        (serde_json::Map::new(), source.to_string())
    }
}

#[tauri::command]
fn choose_apps(state: tauri::State<WindowRuntime>) -> Vec<AppItem> {
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
    state.native_dialog_open.store(true, Ordering::SeqCst);
    let apps = dialog
        .pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| app_item_from_path(&path, true))
        .collect();
    state.native_dialog_open.store(false, Ordering::SeqCst);
    state.protect_focus(Duration::from_millis(800));
    apps
}

#[tauri::command]
fn desktop_apps() -> Vec<AppItem> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = windows_known_import_roots("desktop");
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let profile = PathBuf::from(profile);
            roots.push(profile.join("Desktop"));
            roots.push(profile.join("OneDrive/Desktop"));
        }
        if let Some(public) = std::env::var_os("PUBLIC") {
            roots.push(PathBuf::from(public).join("Desktop"));
        }
        let mut seen = HashSet::new();
        let mut apps: Vec<AppItem> = roots
            .into_iter()
            .flat_map(|root| {
                WalkDir::new(root)
                    .max_depth(1)
                    .into_iter()
                    .filter_map(Result::ok)
            })
            .filter(|entry| entry.file_type().is_file() && is_app(entry.path()))
            .filter_map(|entry| app_item_from_path(entry.path(), true))
            .filter(|app| seen.insert(app.path.to_lowercase()))
            .collect();
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        return apps;
    }
    #[cfg(not(target_os = "windows"))]
    Vec::new()
}

#[cfg(target_os = "windows")]
fn windows_known_import_roots(source: &str) -> Vec<PathBuf> {
    use windows::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{
            FOLDERID_CommonStartMenu, FOLDERID_Desktop, FOLDERID_PublicDesktop, FOLDERID_StartMenu,
            SHGetKnownFolderPath, KF_FLAG_DEFAULT,
        },
    };
    let ids = if source == "desktop" {
        [FOLDERID_Desktop, FOLDERID_PublicDesktop]
    } else {
        [FOLDERID_StartMenu, FOLDERID_CommonStartMenu]
    };
    ids.iter()
        .filter_map(|id| unsafe {
            let value = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
            let path = value.to_string().ok().map(PathBuf::from);
            CoTaskMemFree(Some(value.0.cast()));
            path
        })
        .collect()
}

// Explicitly requested catalog only. This never runs on startup or adds items
// automatically; the UI requires a checked selection before committing.
#[tauri::command]
async fn manual_app_candidates(
    app: tauri::AppHandle,
    source: String,
) -> Result<Vec<AppItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let roots = match source.as_str() {
            "folder" => {
                let state = app.state::<WindowRuntime>();
                state.native_dialog_open.store(true, Ordering::SeqCst);
                let selected = rfd::FileDialog::new().pick_folder();
                state.native_dialog_open.store(false, Ordering::SeqCst);
                state.protect_focus(Duration::from_millis(800));
                selected.into_iter().collect::<Vec<_>>()
            }
            #[cfg(target_os = "windows")]
            "desktop" | "start-menu" => windows_known_import_roots(&source),
            _ => return Err("未知的手动导入来源".into()),
        };
        let mut seen = HashSet::new();
        let mut items = Vec::new();
        for root in roots {
            for entry in WalkDir::new(root)
                .max_depth(4)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
            {
                let path = entry.path();
                if !is_app(path) {
                    continue;
                }
                #[cfg(target_os = "windows")]
                if looks_like_windows_non_app(path) {
                    continue;
                }
                if let Some(item) = app_item_from_path(path, true) {
                    if seen.insert(item.path.to_lowercase()) {
                        items.push(item);
                    }
                }
                if items.len() >= 2000 {
                    break;
                }
            }
            if items.len() >= 2000 {
                break;
            }
        }
        items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(items)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[cfg(any())]
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
    clipboard::read_text()
}

#[tauri::command]
fn set_clipboard_text(text: String) -> Result<(), String> {
    clipboard::write_text(text)
}

fn default_file_search_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let Some(home) = home else { return Vec::new() };
    ["Desktop", "Documents", "Downloads"]
        .into_iter()
        .map(|name| home.join(name))
        .filter(|path| path.exists())
        .collect()
}

#[tauri::command]
async fn search_files(
    query: String,
    roots: Vec<String>,
    limit: usize,
) -> Result<Vec<FileSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let needle = query.trim().to_lowercase();
        if needle.len() < 2 {
            return Vec::new();
        }
        let roots: Vec<PathBuf> = if roots.is_empty() {
            default_file_search_roots()
        } else {
            roots.into_iter().map(PathBuf::from).collect()
        };
        let mut found = Vec::new();
        let maximum = limit.clamp(1, 100);
        for root in roots.into_iter().filter(|root| root.exists()) {
            for entry in WalkDir::new(root)
                .max_depth(6)
                .follow_links(false)
                .into_iter()
                .filter_entry(|entry| {
                    entry.depth() == 0 || !entry.file_name().to_string_lossy().starts_with('.')
                })
                .filter_map(Result::ok)
            {
                if entry.depth() == 0 {
                    continue;
                }
                let name = entry.file_name().to_string_lossy();
                if !name.to_lowercase().contains(&needle) {
                    continue;
                }
                found.push(FileSearchResult {
                    name: name.into_owned(),
                    path: entry.path().to_string_lossy().into_owned(),
                    is_dir: entry.file_type().is_dir(),
                });
                if found.len() >= maximum {
                    return found;
                }
            }
        }
        found
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("文件不存在".into());
    }
    launch_path(path)
}

#[tauri::command]
fn list_apple_shortcuts() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("shortcuts")
            .arg("list")
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        return Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect());
    }
    #[cfg(not(target_os = "macos"))]
    Ok(Vec::new())
}

#[tauri::command]
fn run_apple_shortcut(name: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return Command::new("shortcuts")
            .args(["run", &name])
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = name;
        Err("Apple 快捷指令仅支持 macOS".into())
    }
}

#[tauri::command]
async fn run_system_action(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        return run_macos_system_action(&action);
        #[cfg(target_os = "windows")]
        return run_windows_system_action(&action);
        #[cfg(target_os = "linux")]
        return run_linux_system_action(&action);
    })
    .await
    .map_err(|error| error.to_string())?
}

fn finish_system_command(mut command: Command) -> Result<(), String> {
    let output = command.output().map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let reason = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(if reason.is_empty() {
        format!("系统操作未完成：{}", output.status)
    } else {
        reason
    })
}

#[cfg(target_os = "macos")]
fn run_macos_system_action(action: &str) -> Result<(), String> {
    let command = match action {
        "lock" => {
            let mut value = Command::new("/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession");
            value.arg("-suspend"); value
        }
        "sleep" => { let mut value = Command::new("pmset"); value.arg("sleepnow"); value }
        "sleep-displays" => { let mut value = Command::new("pmset"); value.arg("displaysleepnow"); value }
        "show-screen-saver" => { let mut value = Command::new("open"); value.args(["-a", "ScreenSaverEngine"]); value }
        "open-trash" => { let mut value = Command::new("open"); value.arg(std::env::var("HOME").map(|home| format!("{home}/.Trash")).unwrap_or_else(|_| "/.Trashes".into())); value }
        "restart" => osascript("tell application \"System Events\" to restart"),
        "shut-down" => osascript("tell application \"System Events\" to shut down"),
        "log-out" => osascript("tell application \"System Events\" to log out"),
        "empty-trash" => osascript("tell application \"Finder\" to empty trash"),
        "play-pause" => osascript("tell application \"System Events\" to key code 16"),
        "next-track" => osascript("tell application \"System Events\" to key code 17"),
        "previous-track" => osascript("tell application \"System Events\" to key code 18"),
        "toggle-mute" => osascript("set volume output muted not (output muted of (get volume settings))"),
        "volume-up" => osascript("set volume output volume ((output volume of (get volume settings)) + 10)"),
        "volume-down" => osascript("set volume output volume ((output volume of (get volume settings)) - 10)"),
        "show-desktop" => osascript("tell application \"System Events\" to key code 103"),
        "toggle-hidden-files" => osascript("set v to do shell script \"defaults read com.apple.finder AppleShowAllFiles 2>/dev/null || echo false\"\ndo shell script \"defaults write com.apple.finder AppleShowAllFiles -bool \" & (v is not \"1\" and v is not \"true\")\ntell application \"Finder\" to quit\ndelay 0.2\ntell application \"Finder\" to launch"),
        _ => return Err("不支持的系统操作".into()),
    };
    finish_system_command(command)
}

#[cfg(target_os = "macos")]
fn osascript(script: &str) -> Command {
    let mut command = Command::new("osascript");
    command.args(["-e", script]);
    command
}

#[cfg(target_os = "windows")]
fn run_windows_system_action(action: &str) -> Result<(), String> {
    let command = match action {
        "lock" => { let mut value = hidden_windows_command("rundll32.exe"); value.arg("user32.dll,LockWorkStation"); value }
        "sleep" => powershell_action("Add-Type -AssemblyName System.Windows.Forms;if(-not [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend,$false,$false)){throw 'Windows could not enter sleep. Check the power settings.'}"),
        "hibernate" => { let mut value = hidden_windows_command("shutdown.exe"); value.arg("/h"); value }
        "sleep-displays" => powershell_action("Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class QDisplay{[DllImport(\"user32.dll\",SetLastError=true)]public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,IntPtr l,uint f,uint t,out UIntPtr r);}';$r=[UIntPtr]::Zero;$ok=[QDisplay]::SendMessageTimeout([IntPtr]0xffff,0x0112,[UIntPtr]0xf170,[IntPtr]2,2,1500,[ref]$r);if($ok -eq [IntPtr]::Zero){throw 'Windows could not turn the display off.'}"),
        "restart" => { let mut value = hidden_windows_command("shutdown.exe"); value.args(["/r", "/t", "0"]); value }
        "shut-down" => { let mut value = hidden_windows_command("shutdown.exe"); value.args(["/s", "/t", "0"]); value }
        "log-out" => { let mut value = hidden_windows_command("shutdown.exe"); value.arg("/l"); value }
        "show-screen-saver" => { let mut value = hidden_windows_command("rundll32.exe"); value.arg("desk.cpl,InstallScreenSaver"); value }
        "open-trash" => { let mut value = hidden_windows_command("explorer.exe"); value.arg("shell:RecycleBinFolder"); value }
        "empty-trash" => powershell_action("Clear-RecycleBin -Force -ErrorAction Stop"),
        "toggle-hidden-files" => powershell_action("$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';$v=(Get-ItemProperty $p Hidden).Hidden;Set-ItemProperty $p Hidden (if($v -eq 1){2}else{1});Stop-Process -Name explorer -Force"),
        "play-pause" => windows_media_key(0xB3),
        "next-track" => windows_media_key(0xB0),
        "previous-track" => windows_media_key(0xB1),
        "toggle-mute" => windows_media_key(0xAD),
        "volume-down" => windows_media_key(0xAE),
        "volume-up" => windows_media_key(0xAF),
        "show-desktop" => powershell_action("$s=New-Object -ComObject Shell.Application;$s.ToggleDesktop()"),
        _ => return Err("不支持的系统操作".into()),
    };
    finish_system_command(command)
}

#[cfg(target_os = "windows")]
fn powershell_action(script: &str) -> Command {
    let mut command = hidden_windows_command("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    command
}

#[cfg(target_os = "windows")]
fn windows_media_key(code: u8) -> Command {
    powershell_action(&format!("Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class QK{{[DllImport(\"user32.dll\")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);}}';[QK]::keybd_event({code},0,0,[UIntPtr]::Zero);[QK]::keybd_event({code},0,2,[UIntPtr]::Zero)"))
}

#[cfg(target_os = "linux")]
fn run_linux_system_action(action: &str) -> Result<(), String> {
    let command = match action {
        "lock" => {
            let mut value = Command::new("loginctl");
            value.arg("lock-session");
            value
        }
        "sleep" => {
            let mut value = Command::new("systemctl");
            value.arg("suspend");
            value
        }
        "hibernate" => {
            let mut value = Command::new("systemctl");
            value.arg("hibernate");
            value
        }
        "sleep-displays" => {
            let mut value = Command::new("xset");
            value.args(["dpms", "force", "off"]);
            value
        }
        "restart" => {
            let mut value = Command::new("systemctl");
            value.arg("reboot");
            value
        }
        "shut-down" => {
            let mut value = Command::new("systemctl");
            value.arg("poweroff");
            value
        }
        "log-out" => {
            let mut value = Command::new("loginctl");
            value
                .arg("terminate-user")
                .arg(std::env::var("USER").unwrap_or_default());
            value
        }
        "show-screen-saver" => {
            let mut value = Command::new("xdg-screensaver");
            value.arg("activate");
            value
        }
        "open-trash" => {
            let mut value = Command::new("xdg-open");
            value.arg("trash:///");
            value
        }
        "empty-trash" => {
            let mut value = Command::new("gio");
            value.args(["trash", "--empty"]);
            value
        }
        "play-pause" => {
            let mut value = Command::new("playerctl");
            value.arg("play-pause");
            value
        }
        "next-track" => {
            let mut value = Command::new("playerctl");
            value.arg("next");
            value
        }
        "previous-track" => {
            let mut value = Command::new("playerctl");
            value.arg("previous");
            value
        }
        "toggle-mute" => {
            let mut value = Command::new("pactl");
            value.args(["set-sink-mute", "@DEFAULT_SINK@", "toggle"]);
            value
        }
        "volume-up" => {
            let mut value = Command::new("pactl");
            value.args(["set-sink-volume", "@DEFAULT_SINK@", "+10%"]);
            value
        }
        "volume-down" => {
            let mut value = Command::new("pactl");
            value.args(["set-sink-volume", "@DEFAULT_SINK@", "-10%"]);
            value
        }
        "show-desktop" => {
            let mut value = Command::new("xdotool");
            value.args(["key", "super+d"]);
            value
        }
        _ => return Err("不支持的系统操作".into()),
    };
    finish_system_command(command)
}

#[tauri::command]
async fn run_window_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    let cloned = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || execute_window_action(cloned, action))
        .await.map_err(|e| e.to_string())?;
    if result.is_err() { show_launcher_mode(&app, "commands"); }
    result
}

fn execute_window_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    let action = match action.as_str() {
        "left" | "right" | "top" | "bottom" | "center" | "maximize" | "almost-maximize"
        | "maximize-width" | "maximize-height" => action,
        _ => return Err("不支持的窗口操作".into()),
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        std::thread::sleep(Duration::from_millis(180));
    }
    #[cfg(target_os = "macos")]
    {
        let geometry = match action.as_str() {
            "left" => "set p to {x, y}\nset s to {w / 2, h}",
            "right" => "set p to {x + w / 2, y}\nset s to {w / 2, h}",
            "top" => "set p to {x, y}\nset s to {w, h / 2}",
            "bottom" => "set p to {x, y + h / 2}\nset s to {w, h / 2}",
            "center" => "set s to {w * 0.7, h * 0.7}\nset p to {x + w * 0.15, y + h * 0.15}",
            "almost-maximize" => "set p to {x + 28, y + 28}\nset s to {w - 56, h - 56}",
            "maximize-width" => "set oldS to size of front window\nset oldP to position of front window\nset p to {x, item 2 of oldP}\nset s to {w, item 2 of oldS}",
            "maximize-height" => "set oldS to size of front window\nset oldP to position of front window\nset p to {item 1 of oldP, y}\nset s to {item 1 of oldS, h}",
            _ => "set p to {x, y}\nset s to {w, h}",
        };
        let script = format!("tell application \"Finder\" to set b to bounds of window of desktop\nset x to item 1 of b\nset y to item 2 of b\nset w to item 3 of b - x\nset h to item 4 of b - y\ntell application \"System Events\" to tell first application process whose frontmost is true\n{geometry}\nset position of front window to p\nset size of front window to s\nend tell");
        return Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|error| error.to_string())
            .and_then(|output| {
                if output.status.success() {
                    Ok(())
                } else {
                    Err(String::from_utf8_lossy(&output.stderr).into_owned())
                }
            });
    }
    #[cfg(target_os = "windows")]
    {
        // Actual work-area geometry is deterministic on Win10/11. Win+Alt+Up
        // is not a top-half snap on all supported versions. Check OS errors
        // rather than reporting success merely because PowerShell spawned.
        let script = format!(
            r#"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms;
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class QW{{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);[DllImport("user32.dll")]public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int z,bool p);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);public struct R{{public int L,T,Ri,B;}}}}';
$h=[QW]::GetForegroundWindow(); if($h -eq [IntPtr]::Zero){{throw 'No active window'}};
$m='{action}'; if($m -eq 'maximize'){{[QW]::ShowWindow($h,3)|Out-Null;exit 0}};
[QW]::ShowWindow($h,9)|Out-Null;$r=New-Object QW+R;if(-not [QW]::GetWindowRect($h,[ref]$r)){{throw 'Cannot read active window'}};
$wa=[System.Windows.Forms.Screen]::FromHandle($h).WorkingArea;$x=$wa.X;$y=$wa.Y;$w=$wa.Width;$z=$wa.Height;
switch($m){{
'left' {{$w=[int][Math]::Floor($w/2)}}
'right' {{$half=[int][Math]::Floor($w/2);$x+=$half;$w-=$half}}
'top' {{$z=[int][Math]::Floor($z/2)}}
'bottom' {{$half=[int][Math]::Floor($z/2);$y+=$half;$z-=$half}}
'center' {{$w=[Math]::Min($r.Ri-$r.L,$wa.Width);$z=[Math]::Min($r.B-$r.T,$wa.Height);$x+=[int](($wa.Width-$w)/2);$y+=[int](($wa.Height-$z)/2)}}
'almost-maximize' {{$x+=28;$y+=28;$w-=56;$z-=56}}
'maximize-width' {{$y=$r.T;$z=$r.B-$r.T}}
'maximize-height' {{$x=$r.L;$w=$r.Ri-$r.L}}
}};
if(-not [QW]::MoveWindow($h,$x,$y,[Math]::Max(1,$w),[Math]::Max(1,$z),$true)){{throw 'Cannot resize active window; check permissions'}}"#
        );
        let mut command = hidden_windows_command("powershell.exe");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            ;
        return finish_system_command(command);
    }
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return Err("Wayland 不允许通用窗口控制，请使用桌面环境的窗口快捷键".into());
        }
        // X11/EWMH work area includes panel/dock offsets. Do not silently
        // map unimplemented actions to maximize.
        let read = |program: &str, args: &[&str]| -> Result<String, String> {
            let output = Command::new(program).args(args).output().map_err(|e| format!("需要安装 {program}: {e}"))?;
            if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).into_owned()); }
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
        };
        let id = read("xdotool", &["getactivewindow"])?;
        let desktops = read("wmctrl", &["-d"])?;
        let current = desktops.lines().find(|line| line.split_whitespace().nth(1) == Some("*")).ok_or("无法读取桌面工作区")?;
        let fields: Vec<_> = current.split_whitespace().collect();
        let offset = fields.iter().position(|field| *field == "WA:").ok_or("无法读取工作区尺寸")?;
        let pair = |value: &str, separator: char| -> Result<(i32, i32), String> {
            let (a, b) = value.split_once(separator).ok_or("无效的工作区尺寸")?;
            Ok((a.parse().map_err(|_| "无效的工作区尺寸")?, b.parse().map_err(|_| "无效的工作区尺寸")?))
        };
        let (x, y) = pair(fields.get(offset + 1).ok_or("无法读取工作区位置")?, ',')?;
        let (w, h) = pair(fields.get(offset + 2).ok_or("无法读取工作区尺寸")?, 'x')?;
        let geometry = read("xdotool", &["getwindowgeometry", "--shell", &id])?;
        let field = |key: &str| -> Result<i32, String> {
            geometry.lines().find_map(|line| line.strip_prefix(&format!("{key}="))).and_then(|value| value.parse().ok()).ok_or_else(|| "无法读取窗口尺寸".into())
        };
        let (old_x, old_y, old_w, old_h) = (field("X")?, field("Y")?, field("WIDTH")?, field("HEIGHT")?);
        let (px, py, pw, ph) = match action.as_str() {
            "left" => (x, y, w / 2, h), "right" => (x + w / 2, y, w - w / 2, h),
            "top" => (x, y, w, h / 2), "bottom" => (x, y + h / 2, w, h - h / 2),
            "center" => (x + (w - old_w.min(w)) / 2, y + (h - old_h.min(h)) / 2, old_w.min(w), old_h.min(h)),
            "almost-maximize" => (x + 28, y + 28, w - 56, h - 56),
            "maximize-width" => (x, old_y, w, old_h), "maximize-height" => (old_x, y, old_w, h),
            _ => (x, y, w, h),
        };
        let wm_id = format!("0x{:x}", id.parse::<u64>().map_err(|_| "无效的活动窗口 ID")?);
        read("wmctrl", &["-ir", &wm_id, "-b", "remove,maximized_vert,maximized_horz"])?;
        read("xdotool", &["windowsize", &id, &pw.max(1).to_string(), &ph.max(1).to_string()])?;
        read("xdotool", &["windowmove", &id, &px.to_string(), &py.to_string()])?;
        Ok(())
    }
}

fn expanded_working_directory(value: Option<String>) -> Result<Option<PathBuf>, String> {
    let Some(value) = value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let path = if let Some(rest) = value.strip_prefix("~/") {
        let home = std::env::var_os(if cfg!(target_os = "windows") {
            "USERPROFILE"
        } else {
            "HOME"
        })
        .ok_or_else(|| "无法读取用户目录".to_string())?;
        PathBuf::from(home).join(rest)
    } else {
        PathBuf::from(value)
    };
    if !path.is_dir() {
        return Err(format!("工作目录不存在：{}", path.display()));
    }
    Ok(Some(path))
}

#[cfg(not(target_os = "windows"))]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(target_os = "windows")]
fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[tauri::command]
async fn run_custom_command(
    program: String,
    args: Vec<String>,
    working_directory: Option<String>,
    capture_output: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || execute_custom_command(program, args, working_directory, capture_output))
        .await.map_err(|e| e.to_string())?
}

fn execute_custom_command(
    program: String,
    args: Vec<String>,
    working_directory: Option<String>,
    capture_output: bool,
) -> Result<String, String> {
    if program.trim().is_empty()
        || program.contains('\0')
        || args.iter().any(|arg| arg.contains('\0'))
    {
        return Err("自定义命令无效".into());
    }
    let working_directory = expanded_working_directory(working_directory)?;
    let direct_program = Path::new(program.trim()).is_file();
    #[cfg(target_os = "windows")]
    let mut command = if direct_program {
        hidden_windows_command(program.trim())
    } else {
        let joined = args
            .iter()
            .map(|arg| powershell_quote(arg))
            .collect::<Vec<_>>()
            .join(" ");
        let script = if joined.is_empty() {
            program.clone()
        } else {
            format!("{} {}", program, joined)
        };
        let mut value = hidden_windows_command("powershell.exe");
        value.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        value
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = if direct_program {
        Command::new(program.trim())
    } else {
        let joined = args
            .iter()
            .map(|arg| shell_quote(arg))
            .collect::<Vec<_>>()
            .join(" ");
        let script = if joined.is_empty() {
            program.clone()
        } else {
            format!("{} {}", program, joined)
        };
        let mut value = Command::new(if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/sh"
        });
        value.args(["-lc", &script]);
        value
    };
    if direct_program {
        command.args(&args);
    }
    if let Some(directory) = working_directory {
        command.current_dir(directory);
    }
    if capture_output {
        let output = command.output().map_err(|error| error.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if output.status.success() {
            Ok(if stdout.is_empty() { stderr } else { stdout })
        } else {
            Err(if stderr.is_empty() {
                format!("命令退出状态：{}", output.status)
            } else {
                stderr
            })
        }
    } else {
        command
            .spawn()
            .map(|_| String::new())
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn open_external_url(url: String, open_with_bundle_id: Option<String>) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    let _ = &open_with_bundle_id;
    let Some((scheme, _)) = url.split_once(':') else {
        return Err("链接缺少协议".into());
    };
    if scheme.is_empty()
        || !scheme
            .as_bytes()
            .first()
            .map(|value| value.is_ascii_alphabetic())
            .unwrap_or(false)
        || !scheme
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '+' | '-' | '.'))
        || scheme.eq_ignore_ascii_case("file")
        || url.contains('\0')
    {
        return Err("链接协议无效".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("open");
        if let Some(bundle_id) = open_with_bundle_id
            .filter(|value| !value.is_empty())
            .filter(|value| {
                value.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
                })
            })
        {
            c.args(["-b", &bundle_id]);
        }
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = hidden_windows_command("rundll32.exe");
        c.args(["url.dll,FileProtocolHandler", &url]);
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

#[cfg(any())]
mod removed_extension_runtime {
    use super::*;

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
                // its pre-built bundle is likewise not executable in qimiao.
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
            .user_agent("qimiao/0.9.9")
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
            .user_agent("qimiao/0.9.9")
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
}

#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    app.tray_by_id("main-tray")
        .ok_or("未找到菜单栏图标")?
        .set_visible(visible)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_launcher(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

fn centered_resize_origin(
    position: tauri::PhysicalPosition<i32>,
    old_size: tauri::PhysicalSize<u32>,
    new_size: tauri::PhysicalSize<u32>,
    area: Option<&tauri::PhysicalRect<i32, u32>>,
) -> tauri::PhysicalPosition<i32> {
    let mut x = position.x + (old_size.width as i64 - new_size.width as i64) as i32 / 2;
    let mut y = position.y + (old_size.height as i64 - new_size.height as i64) as i32 / 2;
    if let Some(area) = area {
        x = x.clamp(area.position.x, area.position.x + area.size.width.saturating_sub(new_size.width) as i32);
        y = y.clamp(area.position.y, area.position.y + area.size.height.saturating_sub(new_size.height) as i32);
    }
    tauri::PhysicalPosition::new(x, y)
}

#[tauri::command]
fn set_window_layout(window: tauri::WebviewWindow, layout: String) -> Result<(), String> {
    let (width, height, min_width, min_height) = match layout.as_str() {
        "grid" => (920.0_f64, 600.0_f64, 740.0_f64, 480.0_f64),
        "list" => (680.0_f64, 600.0_f64, 620.0_f64, 480.0_f64),
        "compact" => (680.0_f64, 430.0_f64, 480.0_f64, 320.0_f64),
        _ => return Err("未知窗口布局".into()),
    };
    window
        .app_handle()
        .state::<WindowRuntime>()
        .protect_focus(Duration::from_millis(900));
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?;
    let old_geometry = window.outer_position().ok().zip(window.outer_size().ok());
    let (width, height) = monitor
        .as_ref()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            (
                width.min(monitor.work_area().size.width as f64 / scale * 0.92),
                height.min(monitor.work_area().size.height as f64 / scale * 0.88),
            )
        })
        .unwrap_or((width, height));
    window
        .set_min_size(Some(tauri::LogicalSize::new(
            min_width.min(width),
            min_height.min(height),
        )))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    // Resize about the existing centre, not a top corner. Keep a dragged
    // launcher on its current monitor and clamp it inside the work area.
    if let (Some((position, old_size)), Ok(new_size)) = (old_geometry, window.outer_size()) {
        let position = centered_resize_origin(position, old_size, new_size, monitor.as_ref().map(|m| m.work_area()));
        window.set_position(position).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    apply_windows_rounded_region(&window).map_err(|error| error.to_string())?;
    Ok(())
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
    follow_system: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Native Acrylic leaks beyond transparent rounded windows on Windows
        // 10 and may paint a second non-client strip in WebView2. The clipped
        // web surface renders the chosen material consistently instead.
        window.set_effects(None).map_err(|e| e.to_string())?;
        let _ = (material, dark, follow_system);
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{
            NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua,
            NSAppearanceNameDarkAqua, NSGlassEffectView, NSGlassEffectViewStyle, NSWindow,
        };
        let ns_window =
            unsafe { &*(window.ns_window().map_err(|e| e.to_string())? as *const NSWindow) };
        let appearance = NSAppearance::appearanceNamed(unsafe {
            if dark {
                NSAppearanceNameDarkAqua
            } else {
                NSAppearanceNameAqua
            }
        });
        // Release a previously forced window appearance when returning to
        // System. Otherwise WebKit's media query keeps reporting the forced
        // theme rather than the user's current macOS appearance.
        ns_window.setAppearance(if follow_system {
            None
        } else {
            appearance.as_deref()
        });
        if let Some(content) = ns_window.contentView() {
            if let Some(glass) = content.downcast_ref::<NSGlassEffectView>() {
                glass.setCornerRadius(26.0);
                glass.setClipsToBounds(true);
                glass.setStyle(if material == "liquid" {
                    NSGlassEffectViewStyle::Clear
                } else {
                    NSGlassEffectViewStyle::Regular
                });
            }
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (window, material, dark, follow_system);
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
        let pane = match kind.as_str() {
            "accessibility" => "Privacy_Accessibility",
            "automation" => "Privacy_Automation",
            _ => "Privacy_ListenEvent",
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
fn set_windows_rounded_region(hwnd: isize, _size: tauri::PhysicalSize<u32>, _scale: f64) {
    type NativeHandle = isize;
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

    // A GDI round region is binary (jagged) and its 26px radius disagreed with
    // WebView's anti-aliased mask. Clear it, disable the second DWM curve and
    // let ONE 6px CSS surface supply per-pixel-alpha corners on Win10/11.
    let preference: u32 = 1; // DWMWCP_DONOTROUND
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
        let _ = SetWindowRgn(hwnd, 0, 1);
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_rounded_region(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    enforce_windows_frameless(window.hwnd()?.0 as isize);
    set_windows_rounded_region(
        window.hwnd()?.0 as isize,
        window.outer_size()?,
        window.scale_factor().unwrap_or(1.0),
    );
    Ok(())
}

#[cfg(target_os = "windows")]
fn enforce_windows_frameless(hwnd: isize) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CAPTION, WS_MAXIMIZEBOX,
        WS_MINIMIZEBOX, WS_SYSMENU,
    };
    unsafe {
        let style = GetWindowLongPtrW(hwnd as _, GWL_STYLE) as u32;
        let clean = style & !(WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
        if clean != style {
            SetWindowLongPtrW(hwnd as _, GWL_STYLE, clean as isize);
        }
        SetWindowPos(
            hwnd as _,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        );
    }
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

#[derive(serde::Deserialize)]
struct ShortcutBinding {
    target: String,
    accelerator: String,
}

fn parse_shortcut_bindings(bindings: Vec<ShortcutBinding>) -> Result<Vec<(Shortcut, String, bool)>, String> {
    let mut parsed: Vec<(Shortcut, String, bool)> = Vec::new();
    for binding in bindings {
        if !matches!(binding.target.as_str(), "apps" | "clipboard" | "commands") {
            return Err("未知快捷键目标".into());
        }
        if binding.accelerator.trim().is_empty() { continue; }
        let shortcut = shortcut_from_text(binding.accelerator.trim())?;
        if parsed.iter().any(|(other, target, _)| other.id() == shortcut.id() || target == &binding.target) {
            return Err("快捷键不能重复，请为不同功能设置不同组合键".into());
        }
        parsed.push((shortcut, binding.target, binding.accelerator == "DoubleControl"));
    }
    Ok(parsed)
}

#[tauri::command]
fn set_global_shortcuts(
    app: tauri::AppHandle,
    state: tauri::State<ShortcutRuntime>,
    bindings: Vec<ShortcutBinding>,
) -> Result<(), String> {
    let parsed = parse_shortcut_bindings(bindings)?;
    let mut current = state.bindings.lock().map_err(|e| e.to_string())?;
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    for (shortcut, _, _) in &parsed {
        if let Err(error) = app.global_shortcut().register(*shortcut) {
            let _ = app.global_shortcut().unregister_all();
            for (previous, _, _) in current.iter() {
                let _ = app.global_shortcut().register(*previous);
            }
            return Err(format!("系统无法注册此快捷键：{error}"));
        }
    }
    *current = parsed;
    if let Ok(mut pressed) = state.pressed.lock() { pressed.clear(); }
    if let Ok(mut last) = state.last_control.lock() { *last = None; }
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
    let area = monitor.work_area().size;
    let origin = monitor.work_area().position;
    let x = origin.x + (area.width.saturating_sub(size.width) / 2) as i32;
    let y = origin.y + ((area.height.saturating_sub(size.height)) as f64 * 0.58) as i32;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
fn start_launcher_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .app_handle()
        .state::<WindowRuntime>()
        .protect_focus(Duration::from_millis(1500));
    window.start_dragging().map_err(|error| error.to_string())
}

fn show_launcher(app: &tauri::AppHandle) { show_launcher_mode(app, "apps"); }

pub(crate) fn show_launcher_mode(app: &tauri::AppHandle, mode: &str) {
    if mode == "clipboard" {
        tool_windows::show_clipboard(app, false);
        return;
    }
    let handle = app.clone();
    let mode = mode.to_string();
    let _ = app.run_on_main_thread(move || {
    let app = &handle;
    if let Some(w) = app.get_webview_window("main") {
        tool_windows::remember_target(app);
        if let Some(clipboard) = app.get_webview_window("clipboard") { let _ = clipboard.hide(); }
        app.state::<WindowRuntime>()
            .protect_focus(Duration::from_millis(300));
        #[cfg(target_os = "windows")]
        let _ = apply_windows_rounded_region(&w);
        position_launcher(&w);
        tool_windows::raise(&w);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to("main", "launcher-shown", mode);
    }
    });
}

fn toggle_launcher(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
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
        glass.setClipsToBounds(true);
        content.setClipsToBounds(true);
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

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "显示启喵").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "设置…").build(app)?;
    let update = MenuItemBuilder::with_id("check_update", "检查更新…").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出启喵").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &settings, &update, &quit])
        .build()?;
    let tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("启喵 · Qimiao")
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
    Ok(())
}

#[cfg(target_os = "windows")]
fn log_windows_startup(message: &str) {
    use std::io::Write;

    let root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("qimiao");
    if fs::create_dir_all(&root).is_err() {
        return;
    }
    if let Ok(mut log) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("startup.log"))
    {
        let _ = writeln!(log, "{}: {message}", std::process::id());
    }
}

pub fn run() {
    #[cfg(target_os = "windows")]
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    #[cfg(not(target_os = "windows"))]
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    tauri::Builder::default()
        .manage(ShortcutRuntime::default())
        .manage(WindowRuntime::default())
        .manage(clipboard::ClipboardRuntime::default())
        .manage(webdav::DavRuntime::default())
        .manage(tool_windows::ToolWindows::default())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("启喵")
                .arg("--autostart")
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let runtime = app.state::<ShortcutRuntime>();
                    if let Ok(mut pressed) = runtime.pressed.lock() {
                        if event.state() == ShortcutState::Released {
                            pressed.remove(&shortcut.id());
                            return;
                        }
                        if !pressed.insert(shortcut.id()) { return; }
                    }
                    if event.state() == ShortcutState::Pressed {
                        let binding = runtime.bindings.lock().ok().and_then(|bindings|
                            bindings.iter().find(|(key, _, _)| key.id() == shortcut.id()).cloned());
                        let Some((_, target, double_control)) = binding else { return; };
                        if double_control {
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
                        match target.as_str() {
                            "apps" => toggle_launcher(app),
                            "clipboard" => tool_windows::show_clipboard(app, true),
                            _ => show_launcher_mode(app, &target),
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // Global shortcuts are optional. Alt+Space and other combinations
            // are commonly reserved by Windows or another launcher. Treating a
            // registration conflict as a setup error made release builds exit
            // silently before either the main window or tray icon was created.
            #[cfg(target_os = "windows")]
            log_windows_startup("setup started");
            if let Err(_error) = app.global_shortcut().register(shortcut) {
                #[cfg(target_os = "windows")]
                log_windows_startup(&format!("initial shortcut registration failed: {_error}"));
            }
            if let Ok(mut bindings) = app.state::<ShortcutRuntime>().bindings.lock() {
                *bindings = vec![(shortcut, "apps".into(), false)];
            }
            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory)?;
            // The tray is useful but must never prevent the launcher from
            // opening. If it cannot be created, Windows keeps a taskbar entry
            // so the user still has a reliable way back into the app.
            let tray_ready = match install_tray(app) {
                Ok(()) => true,
                Err(_error) => {
                    #[cfg(target_os = "windows")]
                    log_windows_startup(&format!("tray creation failed: {_error}"));
                    false
                }
            };
            #[cfg(not(target_os = "windows"))]
            let _ = tray_ready;
            if let Some(w) = app.get_webview_window("main") {
                tool_windows::remember_target(app.handle());
                tool_windows::raise(&w);
                #[cfg(target_os = "windows")]
                {
                    let _ = w.set_shadow(false);
                    let _ = w.set_decorations(false);
                    let _ = w.set_resizable(true);
                    let _ = w.set_skip_taskbar(tray_ready);
                    let _ = w.set_min_size(Some(tauri::LogicalSize::new(740.0, 480.0)));
                    let _ = w.set_size(tauri::LogicalSize::new(920.0, 600.0));
                    let _ = apply_windows_rounded_region(&w);
                }
                position_launcher(&w);
                #[cfg(target_os = "macos")]
                apply_native_glass(&w)?;
                if std::env::args().any(|arg| arg == "--autostart") {
                    let _ = w.hide();
                } else {
                    // Windows may keep the installer or Explorer in the
                    // foreground for a moment after first launch. Give the
                    // initial window enough time to become visible before the
                    // regular "hide on blur" launcher behavior takes over.
                    #[cfg(target_os = "windows")]
                    app.state::<WindowRuntime>()
                        .protect_focus(Duration::from_secs(8));
                    #[cfg(not(target_os = "windows"))]
                    app.state::<WindowRuntime>()
                        .protect_focus(Duration::from_millis(1500));
                    if let Err(_error) = w.show() {
                        #[cfg(target_os = "windows")]
                        log_windows_startup(&format!("show main window failed: {_error}"));
                    }
                    if let Err(_error) = w.set_focus() {
                        #[cfg(target_os = "windows")]
                        log_windows_startup(&format!("focus main window failed: {_error}"));
                    }
                }
            }
            if let Some(w) = app.get_webview_window("clipboard") {
                tool_windows::raise(&w);
                let _ = w.set_min_size(Some(tauri::LogicalSize::new(340.0, 320.0)));
                #[cfg(target_os = "macos")]
                apply_native_glass(&w)?;
            }
            #[cfg(target_os = "windows")]
            log_windows_startup("setup completed");
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
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            if matches!(event, tauri::WindowEvent::Moved(_)) {
                window
                    .app_handle()
                    .state::<WindowRuntime>()
                    .protect_focus(Duration::from_millis(500));
            }
            #[cfg(target_os = "windows")]
            if matches!(event, tauri::WindowEvent::Resized(_)) {
                window
                    .app_handle()
                    .state::<WindowRuntime>()
                    .protect_focus(Duration::from_millis(500));
                let _ = refresh_windows_rounded_region(window);
            }
            if matches!(event, tauri::WindowEvent::Focused(false)) {
                if window.app_handle().state::<WindowRuntime>().should_hide() {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            tool_windows::open_clipboard_window,
            tool_windows::configure_clipboard_window,
            tool_windows::clipboard_paste_status,
            tool_windows::start_tool_resize,
            fonts::list_local_fonts,
            clipboard::clipboard_snapshot,
            clipboard::load_clipboard_history,
            clipboard::save_clipboard_history,
            clipboard::copy_clipboard_item,
            clipboard::paste_clipboard_item,
            clipboard::export_clipboard_item,
            clipboard::webdav_image,
            webdav::webdav_connect,
            webdav::webdav_read,
            webdav::webdav_write,
            webdav::webdav_forget,
            start_launcher_drag,
            scan_apps,
            existing_app_paths,
            launch_app,
            choose_folder,
            export_backup,
            import_backup,
            choose_apps,
            desktop_apps,
            manual_app_candidates,
            clipboard_text,
            set_clipboard_text,
            search_files,
            open_path,
            list_apple_shortcuts,
            run_apple_shortcut,
            run_system_action,
            run_window_action,
            run_custom_command,
            open_external_url,
            set_tray_visible,
            hide_launcher,
            set_window_layout,
            set_auto_start,
            get_auto_start,
            set_window_material,
            read_icon,
            load_app_icon,
            open_macos_permission,
            set_global_shortcuts,
            suspend_global_shortcuts
        ])
        .run(tauri::generate_context!())
        .expect("error while running qimiao");
}

#[cfg(any())]
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
            "C:/Start Menu/SoapUI 5.9.1 Uninstall.lnk",
            "C:/Program Files/App/unins000.exe",
            "C:/Program Files/App/Updater.exe",
            "C:/Windows/System32/Administrative Tools.lnk",
            "C:/Windows/System32/Task Manager.lnk",
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
    fn windows_icons_have_equal_optical_size_despite_source_padding() {
        let mut plain = image::RgbaImage::new(32, 32);
        for pixel in plain.pixels_mut() {
            *pixel = image::Rgba([200, 30, 40, 255]);
        }
        let mut padded = image::RgbaImage::new(128, 128);
        image::imageops::overlay(&mut padded, &plain, 48, 48);
        let normalized = normalize_windows_icon(plain);
        assert_eq!(normalized, normalize_windows_icon(padded));
        assert_eq!(normalized.dimensions(), (160, 160));
        assert_eq!(normalized.get_pixel(0, 0)[3], 0);
        assert_eq!(normalized.get_pixel(80, 80)[3], 255);
    }
    #[test]
    fn windows_icon_normalization_handles_portrait_and_empty_sources() {
        let portrait = image::RgbaImage::from_pixel(16, 64, image::Rgba([20, 80, 200, 255]));
        let normalized = normalize_windows_icon(portrait);
        assert_eq!(normalized.dimensions(), (160, 160));
        let empty = normalize_windows_icon(image::RgbaImage::new(8, 8));
        assert_eq!(empty.dimensions(), (160, 160));
        assert!(empty.get_pixel(80, 80)[3] > 0);
    }
    #[test]
    fn windows_icons_ignore_faint_canvas_and_opaque_white_padding() {
        let mut faint = image::RgbaImage::from_pixel(160, 160, image::Rgba([40, 60, 80, 24]));
        for y in 72..88 {
            for x in 72..88 {
                faint.put_pixel(x, y, image::Rgba([20, 110, 220, 255]));
            }
        }
        assert_eq!(windows_icon_bounds(&faint), Some((72, 72, 87, 87)));
        let normalized = normalize_windows_icon(faint);
        let blue = normalized
            .enumerate_pixels()
            .filter(|(_, _, p)| p[2] > 180 && p[0] < 80)
            .map(|(x, y, _)| (x, y))
            .collect::<Vec<_>>();
        assert!(
            blue.iter().map(|(x, _)| x).max().unwrap() - blue.iter().map(|(x, _)| x).min().unwrap()
                >= 125
        );
        let mut white = image::RgbaImage::from_pixel(160, 160, image::Rgba([255, 255, 255, 255]));
        for y in 72..88 {
            for x in 72..88 {
                white.put_pixel(x, y, image::Rgba([20, 110, 220, 255]));
            }
        }
        let bounds = windows_icon_bounds(&white).unwrap();
        assert!(bounds.2 - bounds.0 < 24);
        let normalized = normalize_windows_icon(white);
        let blue_width = normalized
            .enumerate_pixels()
            .filter(|(_, _, p)| p[2] > 180 && p[0] < 80)
            .map(|(x, _, _)| x)
            .collect::<Vec<_>>();
        assert!(blue_width.iter().max().unwrap() - blue_width.iter().min().unwrap() > 100);
    }
    #[test]
    fn explicit_catalog_hides_maintenance_but_accepts_application_shortcuts() {
        for name in [
            "Uninstall IDM.lnk",
            "卸载微信.lnk",
            "unins000.exe",
            "Command Prompt.lnk",
            "Task Manager.lnk",
        ] {
            assert!(looks_like_windows_non_app(Path::new(name)), "{name}");
        }
        for name in [
            "Telegram.lnk",
            "Clippi.lnk",
            "ASUS DriverHub.lnk",
            "MicYou.lnk",
            "PicLite.exe",
        ] {
            assert!(!looks_like_windows_non_app(Path::new(name)), "{name}");
        }
    }
    #[test]
    fn runs_captured_custom_shell_command_in_working_directory() {
        let root =
            std::env::temp_dir().join(format!("qimiao-command-fixture-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let output = execute_custom_command(
            "printf '%s' \"$PWD\"".into(),
            Vec::new(),
            Some(root.to_string_lossy().into_owned()),
            true,
        )
        .unwrap();
        assert_eq!(
            Path::new(&output).canonicalize().unwrap(),
            root.canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn quotes_custom_command_arguments() {
        let output = execute_custom_command(
            "printf '%s'".into(),
            vec!["hello world's".into()],
            None,
            true,
        )
        .unwrap();
        assert_eq!(output, "hello world's");
    }
    #[test]
    fn imports_tinycast_archive_models() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("qimiao-tinycast-fixture-{stamp}"));
        let source = root.join("source");
        fs::create_dir_all(source.join("snippets")).unwrap();
        fs::create_dir_all(source.join("notes")).unwrap();
        fs::create_dir_all(source.join("clipboard")).unwrap();
        fs::write(source.join("manifest.json"), r#"{"format":1,"appVersion":"1","createdAt":"2026-01-01T00:00:00Z","counts":{"settings":1}}"#).unwrap();
        fs::write(source.join("settings.json"), r#"{"quicklinks":[{"name":"Search","link":"https://example.com?q={argument}"}],"customCommands":[]}"#).unwrap();
        fs::write(source.join("snippets/greeting.md"), "---\nname: \"Greeting\"\nkeyword: \"!hi\"\nenabled: true\nshow_confirmation: false\n---\nHello {argument}").unwrap();
        fs::write(source.join("notes/Plan.md"), "# Plan\n- [ ] Ship").unwrap();
        fs::write(
            source.join("clipboard/items.jsonl"),
            "{\"kind\":\"text\",\"text\":\"Copied text\",\"createdAt\":\"2026-01-01T00:00:00Z\"}\n",
        )
        .unwrap();
        let archive = root.join("fixture.tinycast");
        let status = Command::new("/usr/bin/aa")
            .args(["archive", "-d"])
            .arg(&source)
            .args(["-o"])
            .arg(&archive)
            .status()
            .unwrap();
        assert!(status.success());
        let imported: serde_json::Value =
            serde_json::from_str(&read_tinycast_archive(&archive).unwrap()).unwrap();
        assert_eq!(imported["settings"]["quicklinks"][0]["name"], "Search");
        assert_eq!(imported["snippets"][0]["keyword"], "!hi");
        assert_eq!(imported["notes"][0]["title"], "Plan");
        assert_eq!(imported["clipboardEntries"][0], "Copied text");
        let _ = fs::remove_dir_all(root);
    }
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
            "CommandOrControl+Shift+V",
            "CommandOrControl+Shift+K",
            "Control+KeyK",
            "Command+KeyK",
            "Control+Backquote",
            "Control+Shift+Equal",
        ] {
            assert!(value.parse::<Shortcut>().is_ok(), "{value}");
        }
    }
    #[test]
    fn physical_control_and_command_remain_distinct() {
        assert_ne!(shortcut_from_text("Control+KeyK").unwrap().id(), shortcut_from_text("Command+KeyK").unwrap().id());
    }
    #[test]
    fn shortcut_bindings_route_independently_and_reject_duplicates() {
        let binding = |target: &str, accelerator: &str| ShortcutBinding { target: target.into(), accelerator: accelerator.into() };
        let parsed = parse_shortcut_bindings(vec![binding("apps", "DoubleControl"), binding("clipboard", "CommandOrControl+Shift+V"), binding("commands", "CommandOrControl+Shift+K")]).unwrap();
        assert_eq!(parsed.len(), 3);
        assert!(parsed[0].2);
        assert!(!parsed[1].2);
        assert_eq!(parsed[1].1, "clipboard");
        assert_ne!(parsed[0].0.id(), parsed[1].0.id());
        assert!(parse_shortcut_bindings(vec![binding("apps", "Alt+Space"), binding("commands", "Alt+Space")]).is_err());
        assert!(parse_shortcut_bindings(vec![binding("invalid", "Alt+Space")]).is_err());
        assert_eq!(parse_shortcut_bindings(vec![binding("apps", "Alt+Space"), binding("commands", "")]).unwrap().len(), 1);
    }
    #[test]
    fn resizing_keeps_the_midpoint_including_negative_monitor_coordinates() {
        use tauri::{PhysicalPosition as P, PhysicalRect as R, PhysicalSize as S};
        let compact = centered_resize_origin(P::new(300, 200), S::new(920, 600), S::new(680, 430), None);
        assert_eq!(compact, P::new(420, 285));
        assert_eq!(centered_resize_origin(compact, S::new(680, 430), S::new(920, 600), None), P::new(300, 200));
        let area = R { position: P::new(-1920, 40), size: S::new(1920, 1040) };
        assert_eq!(centered_resize_origin(P::new(-1500, 200), S::new(920, 600), S::new(680, 430), Some(&area)), P::new(-1380, 285));
        assert_eq!(centered_resize_origin(P::new(-1900, 40), S::new(680, 430), S::new(920, 600), Some(&area)), P::new(-1920, 40));
    }
    #[cfg(any())]
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
            r#"{"name":"@community/hello-world","title":"Hello World","author":"qimiao","commands":[{"name":"hello","title":"Hello","description":"A real Raycast-format command","mode":"view"}]}"#,
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
