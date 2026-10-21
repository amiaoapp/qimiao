import { defaultClipOptions, type ClipOptions } from "./clipboard-core";
export type DavOptions = { url: string; username: string; allowInsecure: boolean; remember: boolean; clipboardEnabled: boolean; configurationEnabled: boolean; autoClipboard: boolean; syncImages: boolean; intervalMinutes: number };
export const defaultDavOptions: DavOptions = { url:"", username:"", allowInsecure:false, remember:true, clipboardEnabled:false, configurationEnabled:false, autoClipboard:false, syncImages:false, intervalMinutes:15 };
export type AppItem = {
  id: string;
  name: string;
  path: string;
  icon?: string;
  searchTerms?: string;
  appCategory?: string;
  lastUsed?: number;
  installedAt?: number;
  launchCount: number;
  favorite: boolean;
  pinnedAt?: number;
  manual?: boolean;
  category?: string;
  folder?: { id: string; name: string };
};
export type Theme = "system" | "light" | "dark";
export type Material = "glass" | "liquid" | "solid";
export type UpdateCheckSchedule = "launch" | "daily" | "weekly" | "manual";
export type LauncherMode = "apps" | "commands" | "clipboard" | "ai";
export type CommandArgument = {
  name: string;
  optional?: boolean;
  defaultValue?: string;
  options?: string[];
};
export type CommandTool = {
  id: string;
  type: "quicklink" | "snippet" | "note" | "custom";
  title: string;
  content: string;
  args?: string[];
  arguments?: CommandArgument[];
  alias?: string;
  keyword?: string;
  enabled?: boolean;
  showsInRootSearch?: boolean;
  pinnedAt?: string;
  createdAt?: string;
  openWithBundleID?: string;
  iconSymbol?: string;
  requiresConfirmation?: boolean;
  showsConfirmation?: boolean;
  showsOutput?: boolean;
  workingDirectory?: string;
  source?: "qimiao" | "tinycast" | "raycast";
};
export type ViewMode = "grid" | "list";
export type SortBy =
  | "smart"
  | "nameAsc"
  | "nameDesc"
  | "recentUsed"
  | "recentInstalled"
  | "mostUsed";
export type Settings = {
  language: "zh" | "en";
  theme: Theme;
  material: Material;
  fontFamily: string;
  motionEffects: boolean;
  compactMode: boolean;
  viewMode: ViewMode;
  sortBy: SortBy;
  categories: string[];
  showRecommendations: boolean;
  autoScanApps: boolean;
  scanOnLaunch: boolean;
  confirmScanResults: boolean;
  scanDirs: string[];
  hotkey: string;
  clipboardHotkey: string;
  commandsHotkey: string;
  hideTray: boolean;
  autoStart: boolean;
  updateCheckSchedule: UpdateCheckSchedule;
  clipboardHistoryEnabled: boolean;
  clipboardOptions: ClipOptions;
  webdav: DavOptions;
  fileSearchDirs: string[];
  aiProvider: string;
  aiEndpoint: string;
  aiModel: string;
  apiKey: string;
};
export const defaultSettings: Settings = {
  language: "zh",
  theme: "system",
  material: "liquid",
  fontFamily: "",
  motionEffects: true,
  compactMode: false,
  viewMode: "grid",
  sortBy: "smart",
  categories: ["效率工具", "开发工具", "创意设计", "娱乐休闲"],
  showRecommendations: true,
  autoScanApps: false,
  scanOnLaunch: false,
  confirmScanResults: false,
  scanDirs: [],
  hotkey: "Alt+Space",
  clipboardHotkey: "CommandOrControl+Shift+V",
  commandsHotkey: "CommandOrControl+Shift+K",
  hideTray: false,
  autoStart: false,
  updateCheckSchedule: "launch",
  clipboardHistoryEnabled: true,
  clipboardOptions: defaultClipOptions,
  webdav: defaultDavOptions,
  fileSearchDirs: [],
  aiProvider: "OpenAI Compatible",
  aiEndpoint: "https://api.openai.com/v1/chat/completions",
  aiModel: "gpt-4o-mini",
  apiKey: "",
};
