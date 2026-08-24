use serde::Serialize;
use sha2::{Digest, Sha256};
use base64::{engine::general_purpose::STANDARD,Engine};
use std::{collections::HashSet, fs, path::{Path, PathBuf}, process::Command, sync::{Mutex,atomic::{AtomicBool,Ordering}}, time::{Duration,Instant}};
use tauri::{Emitter,Manager, menu::{MenuBuilder,MenuItemBuilder}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppItem { id: String, name: String, path: String, icon: Option<String>, search_terms: String, installed_at: Option<u64>, launch_count: u32, favorite: bool }
struct ShortcutRuntime { double_control: AtomicBool, last_control: Mutex<Option<Instant>> }
impl Default for ShortcutRuntime { fn default()->Self{Self{double_control:AtomicBool::new(false),last_control:Mutex::new(None)}} }

fn default_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(target_os="macos")]
    { dirs.extend([PathBuf::from("/Applications"), PathBuf::from("/System/Applications")]); if let Some(home)=std::env::var_os("HOME") { dirs.push(PathBuf::from(home).join("Applications")); } }
    #[cfg(target_os="windows")]
    { for key in ["ProgramFiles", "ProgramFiles(x86)", "APPDATA", "PROGRAMDATA"] { if let Some(v)=std::env::var_os(key) { dirs.push(PathBuf::from(v)); } } }
    #[cfg(target_os="linux")]
    { dirs.extend([PathBuf::from("/usr/share/applications"), PathBuf::from("/usr/local/share/applications")]); if let Some(home)=std::env::var_os("HOME") { dirs.push(PathBuf::from(home).join(".local/share/applications")); } }
    dirs
}

fn is_app(path: &Path) -> bool {
    #[cfg(target_os="macos")] { path.extension().is_some_and(|e| e.eq_ignore_ascii_case("app")) }
    #[cfg(target_os="windows")] { path.extension().is_some_and(|e| matches!(e.to_string_lossy().to_ascii_lowercase().as_str(), "exe"|"lnk")) }
    #[cfg(target_os="linux")] { path.extension().is_some_and(|e| e.eq_ignore_ascii_case("desktop")) }
}

fn color_for(name:&str)->String { let palette=["#536dfe","#ef5350","#26a69a","#7e57c2","#42a5f5","#ec407a","#ff8f00","#455a64"]; let n=name.bytes().fold(0usize,|a,b|a+b as usize); format!("{}|{}",palette[n%palette.len()],name.chars().next().unwrap_or('?')) }

#[cfg(target_os="macos")]
fn normalize_icon(path:&Path){let Ok(source)=image::open(path).map(|i|i.to_rgba8()) else{return};let (w,h)=source.dimensions();let mut bounds=(w,h,0,0);for y in 0..h{for x in 0..w{if source.get_pixel(x,y)[3]>10{bounds.0=bounds.0.min(x);bounds.1=bounds.1.min(y);bounds.2=bounds.2.max(x);bounds.3=bounds.3.max(y)}}}if bounds.2<=bounds.0||bounds.3<=bounds.1{return}let crop=image::imageops::crop_imm(&source,bounds.0,bounds.1,bounds.2-bounds.0+1,bounds.3-bounds.1+1).to_image();let scale=(144.0/crop.width() as f32).min(144.0/crop.height() as f32);let nw=(crop.width() as f32*scale).round() as u32;let nh=(crop.height() as f32*scale).round() as u32;let resized=image::imageops::resize(&crop,nw,nh,image::imageops::FilterType::Lanczos3);let mut canvas=image::RgbaImage::new(160,160);image::imageops::overlay(&mut canvas,&resized,((160-nw)/2) as i64,((160-nh)/2) as i64);let _=canvas.save(path);}

#[cfg(target_os="macos")]
fn ios_wrapped_icon(path:&Path)->Option<String>{
    let wrapper=path.join("Wrapper"); if !wrapper.exists(){return None}
    let mut icons:Vec<(bool,u64,PathBuf)>=WalkDir::new(&wrapper).max_depth(3).follow_links(false).into_iter().filter_map(Result::ok).filter(|e|e.file_type().is_file()).filter_map(|e|{
        let p=e.into_path();let filename=p.file_name()?.to_string_lossy().to_ascii_lowercase();
        let directly_in_app=p.parent()?.extension().is_some_and(|x|x.eq_ignore_ascii_case("app"));
        if !directly_in_app||!filename.contains("icon")||p.extension().is_none_or(|x|!x.eq_ignore_ascii_case("png")){return None}
        let (w,h)=image::image_dimensions(&p).ok()?;Some((filename.starts_with("appicon"),u64::from(w)*u64::from(h),p))
    }).collect();
    icons.sort_by_key(|(preferred,area,_)|std::cmp::Reverse((*preferred,*area)));let (_,_,source)=icons.into_iter().next()?;
    let digest=format!("{:x}",Sha256::digest(format!("ios-icon-v3:{}",source.to_string_lossy()).as_bytes()));
    let cache=std::env::temp_dir().join("miaoqi-icons");let _=fs::create_dir_all(&cache);let output=cache.join(format!("{digest}.png"));
    if !output.exists(){fs::copy(source,&output).ok()?;normalize_icon(&output)}
    fs::read(output).ok().map(|bytes|format!("data:image/png;base64,{}",STANDARD.encode(bytes)))
}

#[cfg(target_os="macos")]
fn app_icon(path:&Path,name:&str)->String {
    if let Some(icon)=ios_wrapped_icon(path){return icon}
    if path.starts_with("/System/Applications"){return quicklook_icon(path,name)}
    let resources=path.join("Contents/Resources");
    let declared=plist::Value::from_file(path.join("Contents/Info.plist")).ok().and_then(|v|v.into_dictionary()).and_then(|d|d.get("CFBundleIconFile").or_else(||d.get("CFBundleIconName")).and_then(|v|v.as_string()).map(str::to_owned));
    let mut candidates:Vec<PathBuf>=fs::read_dir(&resources).ok().into_iter().flatten().filter_map(Result::ok).map(|e|e.path()).filter(|p|p.extension().is_some_and(|x|x.eq_ignore_ascii_case("icns"))).collect();
    let normalized=|s:&str|s.to_lowercase().replace([' ','-','_'],"");
    candidates.sort_by_key(|candidate|{let stem=candidate.file_stem().unwrap_or_default().to_string_lossy();let n=normalized(&stem);let app=normalized(name);let declared_match=declared.as_ref().is_some_and(|d|normalized(d.trim_end_matches(".icns"))==n);let bad=n.contains("document")||n.contains("file")||n.contains("toolbar")||n.contains("template");-(if declared_match{1000}else if n==app{500}else if n=="appicon"||n=="icon"{300}else if n.contains(&app)||app.contains(&n){150}else if bad{-200}else{0})});
    let Some(icns)=candidates.into_iter().next() else { return quicklook_icon(path,name) };
    let digest=format!("{:x}",Sha256::digest(format!("icon-v4:{}",icns.to_string_lossy()).as_bytes()));
    let cache=std::env::temp_dir().join("miaoqi-icons"); let _=fs::create_dir_all(&cache); let png=cache.join(format!("{digest}.png"));
    if !png.exists(){let _=Command::new("sips").args(["-s","format","png","-Z","160"]).arg(&icns).arg("--out").arg(&png).output();normalize_icon(&png);}
    fs::read(png).ok().map(|bytes|format!("data:image/png;base64,{}",STANDARD.encode(bytes))).unwrap_or_else(||quicklook_icon(path,name))
}

#[cfg(target_os="macos")]
fn quicklook_icon(path:&Path,name:&str)->String {
    use objc2::rc::autoreleasepool;use objc2_app_kit::{NSBitmapImageFileType,NSBitmapImageRep,NSWorkspace};use objc2_foundation::{NSDictionary,NSString};
    let digest=format!("{:x}",Sha256::digest(format!("workspace-v2:{}",path.to_string_lossy()).as_bytes()));
    let cache=std::env::temp_dir().join("miaoqi-quicklook").join(&digest); let _=fs::create_dir_all(&cache);let output=cache.join("icon.png");
    if !output.exists(){autoreleasepool(|_|{let image=NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(&path.to_string_lossy()));let Some(tiff)=image.TIFFRepresentation() else{return};let Some(rep)=NSBitmapImageRep::imageRepWithData(&tiff) else{return};let props=NSDictionary::new();let Some(data)=(unsafe{rep.representationUsingType_properties(NSBitmapImageFileType::PNG,&props)}) else{return};let _=data.writeToFile_atomically(&NSString::from_str(&output.to_string_lossy()),true);});normalize_icon(&output);}
    fs::read(output).ok().map(|bytes|format!("data:image/png;base64,{}",STANDARD.encode(bytes))).unwrap_or_else(||color_for(name))
}
#[cfg(not(target_os="macos"))]
fn app_icon(_path:&Path,name:&str)->String { color_for(name) }

#[cfg(target_os="macos")]
fn localized_app_name(path:&Path,fallback:&str)->String {
    for locale in ["zh-Hans.lproj","zh_CN.lproj","zh-Hant.lproj","zh_TW.lproj","Chinese.lproj"] {
        let strings=path.join("Contents/Resources").join(locale).join("InfoPlist.strings"); if !strings.exists(){continue}
        if let Ok(output)=Command::new("plutil").args(["-convert","json","-o","-"]).arg(&strings).output(){
            if let Ok(value)=serde_json::from_slice::<serde_json::Value>(&output.stdout){for key in ["CFBundleDisplayName","CFBundleName"]{if let Some(name)=value.get(key).and_then(|v|v.as_str()){if !name.trim().is_empty(){return name.to_owned()}}}}
        }
    }
    plist::Value::from_file(path.join("Contents/Info.plist")).ok().and_then(|v|v.into_dictionary()).and_then(|d|d.get("CFBundleDisplayName").or_else(||d.get("CFBundleName")).and_then(|v|v.as_string()).map(str::to_owned)).filter(|n|!n.trim().is_empty()).unwrap_or_else(||fallback.to_owned())
}
#[cfg(not(target_os="macos"))]
fn localized_app_name(_path:&Path,fallback:&str)->String { fallback.to_owned() }

fn scan_apps_blocking(extra_dirs: Vec<String>) -> Vec<AppItem> {
    let mut roots=default_dirs(); roots.extend(extra_dirs.into_iter().map(PathBuf::from));
    let mut seen=HashSet::new(); let mut result=Vec::new();
    for root in roots {
        if !root.exists(){continue}
        let max_depth=if cfg!(target_os="macos"){3}else{5};
        for entry in WalkDir::new(root).max_depth(max_depth).follow_links(false).into_iter().filter_map(Result::ok) {
            let path=entry.path(); if !is_app(path){continue}
            let raw=path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            if raw.is_empty()||raw.starts_with('.')||!seen.insert(raw.to_lowercase()){continue} let display_name=localized_app_name(path,&raw);
            let canonical=path.to_string_lossy().to_string(); let id=format!("{:x}",Sha256::digest(canonical.as_bytes()));
            let installed_at=fs::metadata(path).ok().and_then(|m|m.created().or_else(|_|m.modified()).ok()).and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_millis() as u64);
            result.push(AppItem{id,name:display_name.clone(),path:canonical.clone(),icon:Some(format!("app:{canonical}")),search_terms:format!("{} {}",display_name,raw),installed_at,launch_count:0,favorite:false});
        }
    }
    result.sort_by(|a,b|a.name.to_lowercase().cmp(&b.name.to_lowercase())); result
}

#[tauri::command]
async fn scan_apps(extra_dirs: Vec<String>) -> Result<Vec<AppItem>,String> {
    tauri::async_runtime::spawn_blocking(move||scan_apps_blocking(extra_dirs)).await.map_err(|e|e.to_string())
}

#[tauri::command]
fn launch_app(path: String) -> Result<(),String> {
    #[cfg(target_os="macos")] let mut cmd={let mut c=Command::new("open");c.arg(&path);c};
    #[cfg(target_os="windows")] let mut cmd={let mut c=Command::new("cmd");c.args(["/C","start","",&path]);c};
    #[cfg(target_os="linux")] let mut cmd={let mut c=Command::new("gtk-launch");c.arg(Path::new(&path).file_stem().unwrap_or_default());c};
    cmd.spawn().map(|_|()).map_err(|e|e.to_string())
}

#[tauri::command]
fn choose_folder() -> Option<String> { rfd::FileDialog::new().pick_folder().map(|p|p.to_string_lossy().to_string()) }

#[tauri::command]
fn open_plugin_directory()->Result<String,String>{let dir=std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("Library/Application Support/com.appmiao.miaoqi/plugins");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;Command::new("open").arg(&dir).spawn().map_err(|e|e.to_string())?;Ok(dir.to_string_lossy().into_owned())}

#[tauri::command]
fn clipboard_text()->Result<String,String>{#[cfg(target_os="macos")]let output=Command::new("pbpaste").output();#[cfg(target_os="windows")]let output=Command::new("powershell").args(["-NoProfile","-Command","Get-Clipboard -Raw"]).output();#[cfg(target_os="linux")]let output=Command::new("sh").args(["-c","wl-paste 2>/dev/null || xclip -selection clipboard -o"]).output();let output=output.map_err(|e|e.to_string())?;if output.status.success(){String::from_utf8(output.stdout).map_err(|e|e.to_string())}else{Err(String::from_utf8_lossy(&output.stderr).into_owned())}}

#[tauri::command]
fn open_external_url(url:String)->Result<(),String>{if !url.starts_with("https://")&&!url.starts_with("http://"){return Err("仅支持 http/https 链接".into())}#[cfg(target_os="macos")]let mut command={let mut c=Command::new("open");c.arg(&url);c};#[cfg(target_os="windows")]let mut command={let mut c=Command::new("cmd");c.args(["/C","start","",&url]);c};#[cfg(target_os="linux")]let mut command={let mut c=Command::new("xdg-open");c.arg(&url);c};command.spawn().map(|_|()).map_err(|e|e.to_string())}

#[tauri::command]
fn set_tray_visible(app:tauri::AppHandle,visible:bool)->Result<(),String>{app.tray_by_id("main-tray").ok_or("未找到菜单栏图标")?.set_visible(visible).map_err(|e|e.to_string())}

#[tauri::command]
fn read_icon(path:String)->Result<String,String>{if !path.contains("miaoqi-icons")&&!path.contains("miaoqi-quicklook"){return Err("拒绝读取非图标缓存路径".into())}let bytes=fs::read(path).map_err(|e|e.to_string())?;Ok(format!("data:image/png;base64,{}",STANDARD.encode(bytes)))}

#[tauri::command]
async fn load_app_icon(path:String,name:String)->Result<String,String>{tauri::async_runtime::spawn_blocking(move||{let app=PathBuf::from(&path);if !app.exists()||!app.extension().is_some_and(|e|e.eq_ignore_ascii_case("app")){return Err("无效的应用路径".into())}let icon=app_icon(&app,&name);if icon.contains('|'){Err("未找到应用图标".into())}else{Ok(icon)}}).await.map_err(|e|e.to_string())?}

#[tauri::command]
fn open_macos_permission(kind:String)->Result<(),String>{#[cfg(target_os="macos")]{let pane=if kind=="accessibility"{"Privacy_Accessibility"}else{"Privacy_ListenEvent"};Command::new("open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}")).spawn().map(|_|()).map_err(|e|e.to_string())}#[cfg(not(target_os="macos"))]{let _=kind;Err("此设置仅适用于 macOS".into())}}

fn shortcut_from_text(accelerator:&str)->Result<Shortcut,String>{if accelerator=="DoubleControl"{Ok(Shortcut::new(None,Code::ControlLeft))}else{accelerator.parse().map_err(|e|format!("无效快捷键: {e}"))}}

#[tauri::command]
fn set_global_shortcut(app: tauri::AppHandle, state:tauri::State<ShortcutRuntime>, accelerator: String, previous_accelerator: Option<String>) -> Result<(),String> {
    let shortcut=shortcut_from_text(&accelerator)?;
    app.global_shortcut().unregister_all().map_err(|e|e.to_string())?;
    if let Err(error)=app.global_shortcut().register(shortcut){if let Some(previous)=previous_accelerator.as_deref().and_then(|s|shortcut_from_text(s).ok()){let _=app.global_shortcut().register(previous);}return Err(format!("系统无法注册此快捷键：{error}"))} state.double_control.store(accelerator=="DoubleControl",Ordering::Relaxed);Ok(())
}

#[tauri::command]
fn suspend_global_shortcuts(app:tauri::AppHandle)->Result<(),String>{app.global_shortcut().unregister_all().map_err(|e|e.to_string())}

fn position_launcher(window:&tauri::WebviewWindow) {
    let Ok(Some(monitor))=window.current_monitor() else {return};
    let Ok(size)=window.outer_size() else {return};
    let area=monitor.size(); let origin=monitor.position();
    let x=origin.x+(area.width.saturating_sub(size.width)/2) as i32;
    let y=origin.y+((area.height.saturating_sub(size.height)) as f64*0.58) as i32;
    let _=window.set_position(tauri::PhysicalPosition::new(x,y));
}

fn toggle_launcher(app:&tauri::AppHandle){if let Some(w)=app.get_webview_window("main"){if w.is_visible().unwrap_or(false){let _=w.hide();}else{position_launcher(&w);let _=w.show();let _=w.set_focus();}}}

fn colorful_tray_icon()->tauri::Result<tauri::image::Image<'static>>{tauri::image::Image::from_bytes(include_bytes!("../icons/tray-cat.png"))}

pub fn run() {
    let shortcut=Shortcut::new(Some(Modifiers::ALT),Code::Space);
    tauri::Builder::default()
      .manage(ShortcutRuntime::default())
      .plugin(tauri_plugin_autostart::Builder::new().build())
      .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app,_,event| {
          if event.state()==ShortcutState::Pressed { let runtime=app.state::<ShortcutRuntime>();if runtime.double_control.load(Ordering::Relaxed){let Ok(mut last)=runtime.last_control.lock() else{return};let now=Instant::now();if !last.is_some_and(|previous|now.duration_since(previous)<Duration::from_millis(430)){*last=Some(now);return}*last=None;}toggle_launcher(app)}
      }).build())
      .setup(move |app| {
          app.global_shortcut().register(shortcut)?;
          #[cfg(target_os="macos")]
          app.handle().set_activation_policy(tauri::ActivationPolicy::Accessory)?;
          let show=MenuItemBuilder::with_id("show","显示喵启").build(app)?;let settings=MenuItemBuilder::with_id("settings","设置…").build(app)?;let update=MenuItemBuilder::with_id("check_update","检查更新…").build(app)?;let quit=MenuItemBuilder::with_id("quit","退出喵启").build(app)?;let menu=MenuBuilder::new(app).items(&[&show,&settings,&update,&quit]).build()?;
          let tray=TrayIconBuilder::with_id("main-tray").tooltip("喵启 Miaoqi").menu(&menu).show_menu_on_left_click(false).icon(colorful_tray_icon()?).icon_as_template(false);
          tray.on_tray_icon_event(|tray,event|{if matches!(event,TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}){toggle_launcher(tray.app_handle())}}).build(app)?;
          if let Some(w)=app.get_webview_window("main"){position_launcher(&w)} Ok(())
      })
      .on_menu_event(|app,event|match event.id().as_ref(){"show"=>toggle_launcher(app),"settings"=>{toggle_launcher(app);let _=app.emit("navigate-settings",());},"check_update"=>{toggle_launcher(app);let _=app.emit("check-update",());},"quit"=>app.exit(0),_=>{}})
      .on_window_event(|window,event| { if matches!(event,tauri::WindowEvent::Focused(false)) { let _=window.hide(); } })
      .invoke_handler(tauri::generate_handler![scan_apps,launch_app,choose_folder,open_plugin_directory,clipboard_text,open_external_url,set_tray_visible,read_icon,load_app_icon,open_macos_permission,set_global_shortcut,suspend_global_shortcuts])
      .run(tauri::generate_context!()).expect("error while running Float Launcher");
}

#[cfg(all(test,target_os="macos"))]
mod tests {
    use super::*;
    #[test]
    fn extracts_real_png_icon(){let path=Path::new("/Applications/HandBrake.app");if path.exists(){let icon=app_icon(path,"HandBrake");assert!(icon.starts_with("data:image/png;base64,"));let bytes=STANDARD.decode(icon.trim_start_matches("data:image/png;base64,")).unwrap();assert_eq!(&bytes[..8],&[137,80,78,71,13,10,26,10]);}}
    #[test]
    fn parses_shortcut_presets(){for value in ["Alt+Space","CommandOrControl+Space","CommandOrControl+Shift+Space","Alt+Shift+Space"]{assert!(value.parse::<Shortcut>().is_ok(),"{value}");}}
    #[test]
    fn scan_returns_lazy_icon_markers(){let apps=scan_apps_blocking(vec![]);assert!(!apps.is_empty());assert!(apps.iter().all(|app|app.icon.as_deref().is_some_and(|icon|icon.starts_with("app:"))));}
    #[test]
    fn extracts_ios_appstore_icon(){let path=Path::new("/Applications/Video Reverser.app");if path.exists(){let icon=app_icon(path,"Video Reverser");assert!(icon.starts_with("data:image/png;base64,"));let bytes=STANDARD.decode(icon.trim_start_matches("data:image/png;base64,")).unwrap();let decoded=image::load_from_memory(&bytes).unwrap();assert_eq!(decoded.width(),160);assert_eq!(decoded.height(),160);}}
    #[test]
    fn extracts_wrapped_ios_icon_without_disabled_badge(){let path=Path::new("/Applications/Xiaomi Home.app");if path.exists(){let icon=ios_wrapped_icon(path).expect("应从 Wrapper 中提取原始 AppIcon");let bytes=STANDARD.decode(icon.trim_start_matches("data:image/png;base64,")).unwrap();let decoded=image::load_from_memory(&bytes).unwrap();assert_eq!(decoded.width(),160);assert_eq!(decoded.height(),160);}}
    #[test]
    fn extracts_books_icon(){let path=Path::new("/System/Applications/Books.app");if path.exists(){let icon=app_icon(path,"Books");assert!(icon.starts_with("data:image/png;base64,"));}}
}
