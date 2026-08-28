import type { AppItem } from "./types";
const isTauri = () => "__TAURI_INTERNALS__" in window;
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
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
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
export async function openExternalUrl(url: string) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external_url", { url });
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
export async function setWindowMaterial(material: string, dark: boolean) {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_window_material", { material, dark });
  }
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
