export type AppItem = {
  id: string;
  name: string;
  path: string;
  icon?: string;
  searchTerms?: string;
  lastUsed?: number;
  installedAt?: number;
  launchCount: number;
  favorite: boolean;
  manual?: boolean;
  category?: string;
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
  viewMode: ViewMode;
  sortBy: SortBy;
  categories: string[];
  showRecommendations: boolean;
  autoScanApps: boolean;
  scanOnLaunch: boolean;
  confirmScanResults: boolean;
  scanDirs: string[];
  hotkey: string;
  hideTray: boolean;
  autoStart: boolean;
  updateCheckSchedule: UpdateCheckSchedule;
  clipboardHistoryEnabled: boolean;
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
  viewMode: "grid",
  sortBy: "smart",
  categories: ["效率工具", "开发工具", "创意设计", "娱乐休闲"],
  showRecommendations: true,
  autoScanApps: false,
  scanOnLaunch: false,
  confirmScanResults: false,
  scanDirs: [],
  hotkey: "Alt+Space",
  hideTray: false,
  autoStart: false,
  updateCheckSchedule: "launch",
  clipboardHistoryEnabled: true,
  fileSearchDirs: [],
  aiProvider: "OpenAI Compatible",
  aiEndpoint: "https://api.openai.com/v1/chat/completions",
  aiModel: "gpt-4o-mini",
  apiKey: "",
};
