use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalRect, PhysicalSize};

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardWindowOptions {
    pub position: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
}
#[derive(Default)]
pub struct ToolWindows {
    options: Mutex<ClipboardWindowOptions>,
    target: Mutex<Option<isize>>,
}

pub fn remember_target(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let target = crate::macos_tools::frontmost_pid().map(|pid| pid as isize);
    #[cfg(target_os = "windows")]
    let target = unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId,
        };
        let hwnd = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        (!hwnd.is_null() && pid != std::process::id()).then_some(hwnd as isize)
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let target: Option<isize> = None;
    if let Some(target) = target {
        if let Ok(mut saved) = app.state::<ToolWindows>().target.lock() {
            *saved = Some(target);
        }
    }
}

pub fn restore_target(app: &tauri::AppHandle) -> Result<(), String> {
    let target = *app
        .state::<ToolWindows>()
        .target
        .lock()
        .map_err(|_| "目标窗口状态不可用")?;
    #[cfg(target_os = "macos")]
    {
        let pid = target.ok_or("未找到输入应用，请先点击目标输入框，再用快捷键打开剪贴板 / Focus the destination before opening Clipboard")?;
        if !crate::macos_tools::activate(pid as i32) {
            return Err(
                "目标应用已关闭或无法激活，内容已复制 / Destination unavailable; content copied"
                    .into(),
            );
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(target) = target {
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                GetForegroundWindow, SetForegroundWindow,
            };
            let hwnd = target as *mut std::ffi::c_void;
            SetForegroundWindow(hwnd);
            if GetForegroundWindow() != hwnd {
                return Err(
                    "目标应用无法激活，内容已复制 / Cannot activate destination; content copied"
                        .into(),
                );
            }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = target;
    Ok(())
}

pub fn raise(window: &tauri::WebviewWindow) {
    let _ = window.set_always_on_top(true);
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
        // set_visible_on_all_workspaces also configures the runtime's macOS
        // bookkeeping. The native auxiliary flag allows full-screen Spaces.
        let _ = window.set_visible_on_all_workspaces(true);
        if let Ok(ptr) = window.ns_window() {
            let native = unsafe { &*(ptr as *const NSWindow) };
            native.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary
                    | NSWindowCollectionBehavior::Stationary,
            );
            native.setLevel(25); // NSStatusWindowLevel, above normal/floating windows.
        }
    }
}

fn clamp_origin(
    x: f64,
    y: f64,
    size: PhysicalSize<u32>,
    area: &PhysicalRect<i32, u32>,
) -> PhysicalPosition<i32> {
    PhysicalPosition::new(
        (x as i32).clamp(
            area.position.x,
            area.position.x + area.size.width.saturating_sub(size.width) as i32,
        ),
        (y as i32).clamp(
            area.position.y,
            area.position.y + area.size.height.saturating_sub(size.height) as i32,
        ),
    )
}

fn input_anchor(app: &tauri::AppHandle) -> Option<PhysicalPosition<f64>> {
    let target = (*app.state::<ToolWindows>().target.lock().ok()?)?;
    #[cfg(target_os = "macos")]
    {
        let (x, y) = crate::macos_tools::input_anchor(target as i32)?;
        for monitor in app.available_monitors().ok()? {
            let scale = monitor.scale_factor();
            let p = monitor.position();
            let s = monitor.size();
            if x >= p.x as f64 / scale
                && x < (p.x as f64 + s.width as f64) / scale
                && y >= p.y as f64 / scale
                && y <= (p.y as f64 + s.height as f64) / scale
            {
                return Some(PhysicalPosition::new(x * scale, y * scale));
            }
        }
    }
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::{Foundation::RECT, UI::WindowsAndMessaging::GetWindowRect};
        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(target as *mut std::ffi::c_void, &mut rect) != 0 {
            return Some(PhysicalPosition::new(rect.left as f64, rect.bottom as f64));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = target;
    None
}

fn position_clipboard(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let mode = app
        .state::<ToolWindows>()
        .options
        .lock()
        .map(|o| o.position.clone())
        .unwrap_or_default();
    let cursor = app.cursor_position().ok();
    let anchor = if mode == "input" {
        input_anchor(app).or(cursor)
    } else {
        cursor
    };
    let monitor = anchor
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    if let Ok(size) = window.outer_size() {
        if size.width > area.size.width || size.height > area.size.height {
            let _ = window.set_size(PhysicalSize::new(
                size.width.min(area.size.width),
                size.height.min(area.size.height),
            ));
        }
    }
    let Ok(size) = window.outer_size() else {
        return;
    };
    let (x, y) = if mode == "mouse" || mode == "input" {
        let p = anchor.unwrap_or(PhysicalPosition::new(
            area.position.x as f64,
            area.position.y as f64,
        ));
        let gap = 12.0 * scale;
        let mut y = p.y + gap;
        if y + size.height as f64 > area.position.y as f64 + area.size.height as f64 {
            y = p.y - size.height as f64 - gap;
        }
        (p.x + gap, y)
    } else {
        (
            area.position.x as f64 + area.size.width.saturating_sub(size.width) as f64 / 2.0,
            area.position.y as f64 + area.size.height.saturating_sub(size.height) as f64 / 2.0,
        )
    };
    let _ = window.set_position(clamp_origin(x, y, size, area));
}

#[tauri::command]
pub fn configure_clipboard_window(
    app: tauri::AppHandle,
    options: ClipboardWindowOptions,
    resize: bool,
) -> Result<(), String> {
    if !matches!(options.position.as_str(), "center" | "mouse" | "input") {
        return Err("未知窗口位置".into());
    }
    if let Some(window) = app.get_webview_window("clipboard") {
        if resize {
            let width = options
                .width
                .filter(|v| v.is_finite())
                .unwrap_or(820.0)
                .clamp(340.0, 1600.0);
            let height = options
                .height
                .filter(|v| v.is_finite())
                .unwrap_or(560.0)
                .clamp(320.0, 1200.0);
            window
                .set_size(tauri::LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
        }
    }
    *app.state::<ToolWindows>()
        .options
        .lock()
        .map_err(|_| "窗口状态不可用")? = options;
    Ok(())
}

#[tauri::command]
pub fn open_clipboard_window(app: tauri::AppHandle) {
    show_clipboard(&app, false);
}

pub fn show_clipboard(app: &tauri::AppHandle, toggle: bool) {
    // All AppKit work is performed on the main thread, including shortcuts.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let app = &handle;
        let Some(window) = app.get_webview_window("clipboard") else {
            return;
        };
        if toggle && window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
            let _ = window.hide();
            return;
        }
        remember_target(app);
        app.state::<crate::WindowRuntime>()
            .protect_focus(std::time::Duration::from_millis(300));
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
        }
        position_clipboard(app, &window);
        raise(&window);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to("clipboard", "clipboard-shown", ());
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteStatus {
    trusted: bool,
    executable: String,
}
#[tauri::command]
pub fn clipboard_paste_status() -> PasteStatus {
    PasteStatus {
        #[cfg(target_os = "macos")]
        trusted: crate::macos_tools::paste_allowed(),
        #[cfg(not(target_os = "macos"))]
        trusted: true,
        executable: std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

#[cfg(any(target_os = "macos", test))]
fn resized_frame(frame: [f64; 4], min: [f64; 2], delta: [f64; 2], direction: &str) -> [f64; 4] {
    let [mut x, mut y, mut width, mut height] = frame;
    if direction.contains("East") {
        width = (frame[2] + delta[0]).max(min[0]);
    }
    if direction.contains("West") {
        width = (frame[2] - delta[0]).max(min[0]);
        x = frame[0] + frame[2] - width;
    }
    // AppKit coordinates start at the bottom; screen cursor coordinates at top.
    if direction.contains("North") {
        height = (frame[3] - delta[1]).max(min[1]);
    }
    if direction.contains("South") {
        height = (frame[3] + delta[1]).max(min[1]);
        y = frame[1] + frame[3] - height;
    }
    [x, y, width, height]
}

#[tauri::command]
pub fn start_tool_resize(window: tauri::WebviewWindow, direction: String) -> Result<(), String> {
    if !matches!(
        direction.as_str(),
        "North" | "NorthEast" | "East" | "SouthEast" | "South" | "SouthWest" | "West" | "NorthWest"
    ) {
        return Err("未知缩放方向".into());
    }
    window
        .app_handle()
        .state::<crate::WindowRuntime>()
        .protect_focus(std::time::Duration::from_secs(2));
    #[cfg(not(target_os = "macos"))]
    {
        let native_direction =
            serde_json::from_value(serde_json::json!(direction)).map_err(|e| e.to_string())?;
        return window
            .as_ref()
            .window()
            .start_resize_dragging(native_direction)
            .map_err(|e| e.to_string());
    }
    #[cfg(target_os = "macos")]
    {
        // Tao's macOS drag_resize_window returns NotSupported. Poll the mouse
        // while pressed and apply one AppKit frame transaction per update.
        use objc2_app_kit::NSWindow;
        let app = window.app_handle().clone();
        let start = app.cursor_position().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let native =
            unsafe { &*(window.ns_window().map_err(|e| e.to_string())? as *const NSWindow) };
        let frame = native.frame();
        let min = native.minSize();
        let frame = [
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
        ];
        let min = [min.width, min.height];
        std::thread::spawn(move || {
            let started = std::time::Instant::now();
            while crate::macos_tools::left_mouse_down()
                && started.elapsed() < std::time::Duration::from_secs(60)
            {
                if let Ok(cursor) = app.cursor_position() {
                    let bounds = resized_frame(
                        frame,
                        min,
                        [(cursor.x - start.x) / scale, (cursor.y - start.y) / scale],
                        &direction,
                    );
                    let resized = window.clone();
                    let _ = app.run_on_main_thread(move || {
                        use objc2_foundation::{NSPoint, NSRect, NSSize};
                        if let Ok(ptr) = resized.ns_window() {
                            let native = unsafe { &*(ptr as *const NSWindow) };
                            native.setFrame_display(
                                NSRect::new(
                                    NSPoint::new(bounds[0], bounds[1]),
                                    NSSize::new(bounds[2], bounds[3]),
                                ),
                                true,
                            );
                        }
                    });
                }
                std::thread::sleep(std::time::Duration::from_millis(16));
            }
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn anchors_stay_inside_negative_origin_and_small_monitors() {
        let area = PhysicalRect {
            position: PhysicalPosition::new(-1920, 40),
            size: PhysicalSize::new(1920, 1040),
        };
        assert_eq!(
            clamp_origin(-10.0, 1000.0, PhysicalSize::new(400, 560), &area),
            PhysicalPosition::new(-400, 520)
        );
        assert_eq!(
            clamp_origin(-2200.0, -100.0, PhysicalSize::new(400, 560), &area),
            PhysicalPosition::new(-1920, 40)
        );
    }
    #[test]
    fn corner_resize_keeps_opposite_corner_and_enforces_minimum() {
        let frame = [200.0, 100.0, 920.0, 600.0];
        assert_eq!(
            resized_frame(frame, [740.0, 480.0], [100.0, 80.0], "NorthWest"),
            [300.0, 100.0, 820.0, 520.0]
        );
        assert_eq!(
            resized_frame(frame, [740.0, 480.0], [500.0, 500.0], "NorthWest"),
            [380.0, 100.0, 740.0, 480.0]
        );
        assert_eq!(
            resized_frame(frame, [740.0, 480.0], [100.0, 80.0], "SouthEast"),
            [200.0, 20.0, 1020.0, 680.0]
        );
        assert_eq!(
            resized_frame(frame, [740.0, 480.0], [-500.0, -500.0], "SouthWest"),
            [-300.0, 220.0, 1420.0, 480.0]
        );
    }
}
