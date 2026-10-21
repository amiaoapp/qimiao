//! Native accessibility and event APIs. Automatic paste does not use AppleScript
//! or require permission to automate System Events.
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
use std::{
    ffi::c_void,
    time::{Duration, Instant},
};

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Point {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Size {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rect {
    origin: Point,
    size: Size,
}
type CF = *const c_void;
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> CF;
    fn AXUIElementCopyAttributeValue(element: CF, attribute: CF, value: *mut CF) -> i32;
    fn AXUIElementCopyParameterizedAttributeValue(
        element: CF,
        attribute: CF,
        parameter: CF,
        value: *mut CF,
    ) -> i32;
    fn AXUIElementSetMessagingTimeout(element: CF, timeout: f32) -> i32;
    fn AXValueGetValue(value: CF, kind: u32, output: *mut c_void) -> bool;
    fn CGPreflightPostEventAccess() -> bool;
    fn CGEventSourceCreate(state: i32) -> CF;
    fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
    fn CGEventCreateKeyboardEvent(source: CF, key: u16, down: bool) -> CF;
    fn CGEventSetFlags(event: CF, flags: u64);
    fn CGEventPost(tap: u32, event: CF);
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: CF);
    fn CFStringCreateWithCString(allocator: CF, text: *const i8, encoding: u32) -> CF;
}
struct Owned(CF);
impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

pub fn paste_allowed() -> bool {
    unsafe { AXIsProcessTrusted() && CGPreflightPostEventAccess() }
}
pub fn left_mouse_down() -> bool {
    unsafe { CGEventSourceButtonState(1, 0) }
}
pub fn frontmost_pid() -> Option<i32> {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|app| app.processIdentifier())
        .filter(|pid| *pid != std::process::id() as i32)
}
pub fn activate(pid: i32) -> bool {
    let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) else {
        return false;
    };
    #[allow(deprecated)]
    app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
    let start = Instant::now();
    while !app.isActive() && start.elapsed() < Duration::from_millis(700) {
        std::thread::sleep(Duration::from_millis(20));
    }
    app.isActive()
}

unsafe fn attribute(element: CF, name: &str) -> Option<Owned> {
    let name = std::ffi::CString::new(name).ok()?;
    let key = Owned(CFStringCreateWithCString(
        std::ptr::null(),
        name.as_ptr(),
        0x08000100,
    ));
    let mut result = std::ptr::null();
    if AXUIElementCopyAttributeValue(element, key.0, &mut result) == 0 && !result.is_null() {
        Some(Owned(result))
    } else {
        None
    }
}
/// AX coordinates use a top-left origin in logical screen points.
pub fn input_anchor(pid: i32) -> Option<(f64, f64)> {
    unsafe {
        if !AXIsProcessTrusted() {
            return None;
        }
        let app = Owned(AXUIElementCreateApplication(pid));
        AXUIElementSetMessagingTimeout(app.0, 0.15);
        let focused = attribute(app.0, "AXFocusedUIElement");
        let window = attribute(app.0, "AXFocusedWindow");
        if let Some(element) = &focused {
            if let Some(range) = attribute(element.0, "AXSelectedTextRange") {
                let name = std::ffi::CString::new("AXBoundsForRange").ok()?;
                let key = Owned(CFStringCreateWithCString(
                    std::ptr::null(),
                    name.as_ptr(),
                    0x08000100,
                ));
                let mut result = std::ptr::null();
                if AXUIElementCopyParameterizedAttributeValue(
                    element.0,
                    key.0,
                    range.0,
                    &mut result,
                ) == 0
                    && !result.is_null()
                {
                    let bounds = Owned(result);
                    let mut rect = Rect::default();
                    if AXValueGetValue(bounds.0, 3, &mut rect as *mut _ as *mut c_void)
                        && rect.origin.x.is_finite()
                        && rect.origin.y.is_finite()
                        && rect.size.height.is_finite()
                        && rect.size.height > 0.0
                    {
                        return Some((rect.origin.x, rect.origin.y + rect.size.height));
                    }
                }
            }
        }
        for element in [focused, window].into_iter().flatten() {
            let Some(position) = attribute(element.0, "AXPosition") else {
                continue;
            };
            let Some(size) = attribute(element.0, "AXSize") else {
                continue;
            };
            let mut p = Point::default();
            let mut s = Size::default();
            if AXValueGetValue(position.0, 1, &mut p as *mut _ as *mut c_void)
                && AXValueGetValue(size.0, 2, &mut s as *mut _ as *mut c_void)
                && p.x.is_finite()
                && p.y.is_finite()
                && s.height.is_finite()
                && s.height > 0.0
            {
                return Some((p.x, p.y + s.height));
            }
        }
        None
    }
}

pub fn paste(press_enter: bool) -> Result<(), String> {
    if !paste_allowed() {
        return Err("QIMIAO_MACOS_PASTE_PERMISSION".into());
    }
    // A hotkey may still be physically held when Enter / double click selects
    // an item. Never leak Shift/Control/Option into the destination app.
    let start = Instant::now();
    while [54, 55, 56, 60, 58, 61, 59, 62]
        .iter()
        .any(|key| unsafe { CGEventSourceKeyState(1, *key) })
    {
        if start.elapsed() > Duration::from_millis(1500) {
            return Err("请松开修饰键后重试粘贴 / Release modifier keys and try again".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    unsafe {
        let source = Owned(CGEventSourceCreate(1));
        if source.0.is_null() {
            return Err("无法创建系统按键来源 / Cannot create event source".into());
        }
        for (key, flags) in if press_enter {
            vec![(9, 1_u64 << 20), (36, 0)]
        } else {
            vec![(9, 1_u64 << 20)]
        } {
            let down = Owned(CGEventCreateKeyboardEvent(source.0, key, true));
            let up = Owned(CGEventCreateKeyboardEvent(source.0, key, false));
            if down.0.is_null() || up.0.is_null() {
                return Err("无法创建系统按键 / Cannot create keyboard event".into());
            }
            CGEventSetFlags(down.0, flags);
            CGEventSetFlags(up.0, flags);
            CGEventPost(0, down.0);
            std::thread::sleep(Duration::from_millis(12));
            CGEventPost(0, up.0);
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    Ok(())
}
