//! Enumerate family names with platform APIs. No font files leave this device.

fn clean_families(families: Vec<String>) -> Vec<String> {
    let mut result: Vec<_> = families
        .into_iter()
        .map(|name| name.trim().to_owned())
        .filter(|name| {
            !name.is_empty() && !name.starts_with(['.', '@']) && !name.chars().any(char::is_control)
        })
        .collect();
    result.sort_by_key(|name| name.to_lowercase());
    result.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    result
}

#[cfg(target_os = "windows")]
fn platform_families() -> Result<Vec<String>, String> {
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, EnumFontFamiliesExW, DEFAULT_CHARSET, LOGFONTW, TEXTMETRICW,
    };
    unsafe extern "system" fn collect(
        font: *const LOGFONTW,
        _: *const TEXTMETRICW,
        _: u32,
        context: isize,
    ) -> i32 {
        if !font.is_null() {
            let name = unsafe { &(*font).lfFaceName };
            let length = name.iter().position(|c| *c == 0).unwrap_or(name.len());
            let families = unsafe { &mut *(context as *mut Vec<String>) };
            families.push(String::from_utf16_lossy(&name[..length]));
        }
        1
    }
    let mut families = Vec::<String>::new();
    unsafe {
        let dc = CreateCompatibleDC(std::ptr::null_mut());
        if dc.is_null() {
            return Err("Unable to access the system font catalog".into());
        }
        let mut filter: LOGFONTW = std::mem::zeroed();
        filter.lfCharSet = DEFAULT_CHARSET;
        EnumFontFamiliesExW(
            dc,
            &filter,
            Some(collect),
            &mut families as *mut _ as isize,
            0,
        );
        DeleteDC(dc);
    }
    Ok(clean_families(families))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn platform_families() -> Result<Vec<String>, String> {
    let output = std::process::Command::new("fc-list")
        .arg("--format=%{family}\n")
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("Unable to read the fontconfig catalog".into());
    }
    Ok(clean_families(
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .flat_map(|line| line.split(','))
            .map(str::to_owned)
            .collect(),
    ))
}

#[tauri::command]
pub async fn list_local_fonts(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let result = objc2::MainThreadMarker::new()
                .ok_or_else(|| "Font catalog requires the main thread".to_string())
                .map(|mtm| {
                    let manager = objc2_app_kit::NSFontManager::sharedFontManager(mtm);
                    clean_families(
                        manager
                            .availableFontFamilies()
                            .iter()
                            .map(|name| name.to_string())
                            .collect(),
                    )
                });
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(std::time::Duration::from_secs(8))
                .map_err(|error| error.to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(platform_families)
            .await
            .map_err(|error| error.to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filters_hidden_vertical_invalid_and_duplicate_families() {
        assert_eq!(
            clean_families(vec![
                "Arial".into(),
                "arial".into(),
                "  PingFang SC ".into(),
                ".SF Private".into(),
                "@Vertical".into(),
                "".into(),
                "bad\nfont".into()
            ]),
            vec!["Arial", "PingFang SC"]
        );
    }
}
