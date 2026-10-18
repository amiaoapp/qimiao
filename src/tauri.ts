import type { AppItem } from "./types";
import type { Clip } from "./clipboard-core";
import type { DavOptions } from "./types";
const isTauri = () => "__TAURI_INTERNALS__" in window;
async function desktopInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
export async function clipboardSnapshot(ignoredApps: string[]): Promise<Clip | null> {
  return isTauri() ? desktopInvoke("clipboard_snapshot", { ignoredApps }) : null;
}
export async function loadClipHistory(): Promise<unknown> {
  return isTauri() ? desktopInvoke("load_clipboard_history") : JSON.parse(localStorage.getItem("qimiao-clips-v2") ?? "[]");
}
export async function saveClipHistory(entries: Clip[]) {
  if (isTauri()) await desktopInvoke("save_clipboard_history", { entries });
  else localStorage.setItem("qimiao-clips-v2", JSON.stringify(entries));
}
export async function copyClip(clip: Clip, plain = false, paste = false, pressEnter = false) {
  if (isTauri()) await desktopInvoke(paste ? "paste_clipboard_item" : "copy_clipboard_item", { clip, plain, ...(paste ? { pressEnter } : {}) });
  else if (navigator.clipboard) await navigator.clipboard.writeText(clip.text);
}
export async function exportClip(clip: Clip): Promise<string | null> {
  if (isTauri()) return desktopInvoke("export_clipboard_item", { clip });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([clip.text], { type:"text/plain" })); anchor.download = "clipboard.txt"; anchor.click();
  URL.revokeObjectURL(anchor.href); return "clipboard.txt";
}
export type RemoteDavFile = { data: string; etag: string | null; modified: string | null };
const davConfig = (config: DavOptions) => ({ url:config.url, username:config.username, allowInsecure:config.allowInsecure });
export async function connectDav(config: DavOptions, password: string) {
  if (!isTauri()) throw new Error("WebDAV 连接请在桌面版中使用 / Use the desktop app");
  await desktopInvoke("webdav_connect", { config:davConfig(config), password, remember:config.remember });
}
export async function forgetDav(config: DavOptions) {
  if (isTauri()) await desktopInvoke("webdav_forget", { config:davConfig(config) });
}
export async function readDav(config: DavOptions, kind: "clipboard" | "configuration"): Promise<RemoteDavFile | null> {
  if (!isTauri()) throw new Error("WebDAV 同步请在桌面版中使用 / Use the desktop app");
  return desktopInvoke("webdav_read", { config:davConfig(config), kind });
}
export async function writeDav(config: DavOptions, kind: "clipboard" | "configuration", data: string, remote: RemoteDavFile | null) {
  if (!isTauri()) throw new Error("Use the desktop app");
  await desktopInvoke("webdav_write", { config:davConfig(config), kind, data, etag:remote?.etag ?? null, modified:remote?.modified ?? null, exists:remote !== null });
}
export async function syncDavImage(config: DavOptions, key: string, upload: boolean) {
  if (isTauri()) await desktopInvoke("webdav_image", { config:davConfig(config), key, upload });
}
let fontCatalog: Promise<string[]> | undefined;
export function listLocalFonts(refresh = false): Promise<string[]> {
  if (refresh) fontCatalog = undefined;
  return fontCatalog ??= (async () => {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string[]>("list_local_fonts");
    }
    // Browser preview can verify known local families; desktop enumerates the full OS catalog.
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return [];
    const sample = "Qimiao 启喵 0123";
    context.font = "16px monospace";
    const baseline = context.measureText(sample).width;
    return ["Arial", "Avenir Next", "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", "Georgia", "Times New Roman", "Menlo", "SF Pro Display", "Noto Sans CJK SC"].filter((name) => {
      context.font = `16px ${JSON.stringify(name)}, monospace`;
      return Math.abs(context.measureText(sample).width - baseline) > .1;
    }).sort((a, b) => a.localeCompare(b));
  })().catch((error) => { fontCatalog = undefined; throw error; });
}
export async function scanApps(extra: string[]): Promise<AppItem[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("scan_apps", { extraDirs: extra });
  }
  return demoApps;
}
export async function launchApp(path: string) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("launch_app", { path });
  }
}
export async function chooseFolder(): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("choose_folder");
  }
  return null;
}
export async function chooseApps(): Promise<AppItem[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("choose_apps");
  }
  return [];
}
export async function desktopApps(): Promise<AppItem[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("desktop_apps");
  }
  return [];
}
export async function manualAppCandidates(source:"desktop"|"start-menu"|"folder"):Promise<AppItem[]> {
  return isTauri() ? desktopInvoke("manual_app_candidates",{source}) : [];
}
export async function existingAppPaths(paths: string[]): Promise<string[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("existing_app_paths", { paths });
  }
  return paths;
}
export async function exportBackup(contents: string): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("export_backup", { contents });
  }
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "启喵备份.json";
  anchor.click();
  URL.revokeObjectURL(url);
  return "启喵备份.json";
}
export async function importBackup(): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("import_backup");
  }
  return null;
}
export async function hideLauncher() {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("hide_launcher");
  }
}
export async function setGlobalHotkey(
  accelerator: string,
  previousAccelerator?: string,
) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_global_shortcut", { accelerator, previousAccelerator });
  }
}
export async function suspendGlobalHotkeys() {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("suspend_global_shortcuts");
  }
}
export async function readIcon(path: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("read_icon", { path });
  }
  return "";
}
export async function loadAppIcon(path: string, name: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("load_app_icon", { path, name });
  }
  return "";
}
export async function openMacosPermission(kind: "input" | "accessibility") {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_macos_permission", { kind });
  }
}
export async function openExternalUrl(url: string, openWithBundleId?: string) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external_url", { url, openWithBundleId });
  } else window.open(url, "_blank", "noopener,noreferrer");
}
export async function setTrayVisible(visible: boolean) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_tray_visible", { visible });
  }
}
export async function setAutoStart(enabled: boolean): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_auto_start", { enabled });
  }
  return enabled;
}
export async function getAutoStart(): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_auto_start");
  }
  return false;
}
export async function setWindowMaterial(material: string, dark: boolean, followSystem = false) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_window_material", { material, dark, followSystem });
  }
}
export async function setWindowLayout(layout: "grid" | "list" | "compact") {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_window_layout", { layout });
  }
}
export async function startWindowDrag() {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("start_launcher_drag");
  }
}
export type FileSearchResult = {
  name: string;
  path: string;
  isDir: boolean;
};
export async function clipboardText(): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("clipboard_text");
  }
  return navigator.clipboard?.readText?.() ?? "";
}
export async function setClipboardText(text: string) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_clipboard_text", { text });
  } else await navigator.clipboard?.writeText?.(text);
}
export async function searchFiles(
  query: string,
  roots: string[],
  limit = 40,
): Promise<FileSearchResult[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("search_files", { query, roots, limit });
  }
  return [];
}
export async function openPath(path: string) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_path", { path });
  }
}
export async function listAppleShortcuts(): Promise<string[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("list_apple_shortcuts");
  }
  return [];
}
export async function runAppleShortcut(name: string) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("run_apple_shortcut", { name });
  }
}
export async function runSystemAction(action: string) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("run_system_action", { action });
  }
}
export async function runWindowAction(action: string) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("run_window_action", { action });
  }
}
export async function runCustomCommand(
  program: string,
  args: string[],
  workingDirectory?: string,
  captureOutput = false,
): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("run_custom_command", {
      program,
      args,
      workingDirectory,
      captureOutput,
    });
  }
  return "";
}
const names = [
  "Arc",
  "Calendar",
  "ChatGPT",
  "Chrome",
  "Discord",
  "Figma",
  "Finder",
  "GitHub Desktop",
  "Mail",
  "Maps",
  "Music",
  "Notes",
  "Notion",
  "Photos",
  "Raycast",
  "Safari",
  "Settings",
  "Slack",
  "Telegram",
  "Terminal",
  "Visual Studio Code",
  "WeChat",
  "Xcode",
  "Zoom",
];
const colors = [
  "#4f46e5",
  "#ef4444",
  "#111827",
  "#fbbf24",
  "#5865f2",
  "#a855f7",
  "#60a5fa",
  "#24292f",
  "#38bdf8",
  "#34d399",
  "#fb7185",
  "#facc15",
];
export const demoApps: AppItem[] = names.map((name, i) => ({
  id: `demo-${i}`,
  name,
  path: `/Applications/${name}.app`,
  launchCount: Math.max(0, 20 - i),
  installedAt: Date.now() - i * 86400000,
  favorite: i < 5,
  category: i === 7 ? "开发工具" : undefined,
  icon: `${colors[i % colors.length]}|${name.slice(0, 1)}`,
}));
