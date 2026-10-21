import {
  defaultSettings,
  defaultDavOptions,
  type Settings,
  type AppItem,
} from "./types";
import { defaultClipOptions } from "./clipboard-core";

export function normalizeSettings(stored: Partial<Settings>): Settings {
  const dav = { ...defaultDavOptions };
  for (const key of Object.keys(dav) as (keyof typeof dav)[]) {
    const value = stored.webdav?.[key];
    if (typeof value === typeof dav[key]) Object.assign(dav, { [key]: value });
  }
  dav.intervalMinutes = Number.isFinite(dav.intervalMinutes)
    ? Math.max(5, Math.min(120, dav.intervalMinutes))
    : 15;
  const raw = stored.clipboardOptions;
  const finite = (
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, Math.floor(value)))
      : fallback;
  const rules = { ...defaultClipOptions.rules };
  for (const key of Object.keys(rules) as (keyof typeof rules)[])
    if (typeof raw?.rules?.[key] === "boolean") rules[key] = raw.rules[key];
  return {
    ...defaultSettings,
    ...stored,
    hotkey: typeof stored.hotkey === "string" && stored.hotkey.trim() ? stored.hotkey : defaultSettings.hotkey,
    clipboardHotkey: typeof stored.clipboardHotkey === "string" ? stored.clipboardHotkey : defaultSettings.clipboardHotkey,
    commandsHotkey: typeof stored.commandsHotkey === "string" ? stored.commandsHotkey : defaultSettings.commandsHotkey,
    webdav: dav,
    clipboardOptions: {
      retentionDays: finite(raw?.retentionDays, 30, 0, 3650),
      maxItems: finite(raw?.maxItems, 1000, 100, 3000),
      skipSensitive:
        typeof raw?.skipSensitive === "boolean" ? raw.skipSensitive : true,
      ignoredApps: Array.isArray(raw?.ignoredApps)
        ? raw.ignoredApps
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.slice(0, 256))
            .slice(0, 100)
        : [...defaultClipOptions.ignoredApps],
      rules,
    },
  };
}
const portableKeys = [
  "language",
  "theme",
  "material",
  "fontFamily",
  "motionEffects",
  "compactMode",
  "viewMode",
  "sortBy",
  "showRecommendations",
  "categories",
] as const;
export type AppPreference = Pick<
  AppItem,
  "name" | "favorite" | "category" | "pinnedAt" | "folder"
>;
export type PortableConfig = {
  format: "qimiao-configuration";
  version: 1;
  exportedAt: string;
  settings: Partial<Settings>;
  apps: AppPreference[];
};
export function portableConfiguration(
  settings: Settings,
  apps: AppItem[],
): PortableConfig {
  return {
    format: "qimiao-configuration",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: Object.fromEntries(
      portableKeys.map((key) => [key, settings[key]]),
    ),
    apps: apps.map(({ name, favorite, category, pinnedAt, folder }) => ({
      name,
      favorite,
      category,
      pinnedAt,
      folder,
    })),
  };
}
export function readPortableConfiguration(raw: string): PortableConfig {
  const obj = JSON.parse(raw);
  if (
    obj?.format !== "qimiao-configuration" ||
    obj.version !== 1 ||
    !obj.settings ||
    !Array.isArray(obj.apps)
  )
    throw new Error("无效的启喵配置 / Invalid qimiao configuration");
  const settings: Partial<Settings> = {};
  const source = obj.settings;
  for (const key of ["motionEffects", "showRecommendations", "compactMode"] as const)
    if (typeof source[key] === "boolean") settings[key] = source[key];
  for (const [key, allowed] of [
    ["language", ["zh", "en"]],
    ["theme", ["system", "light", "dark"]],
    ["material", ["solid", "glass", "liquid"]],
    ["viewMode", ["grid", "list"]],
    [
      "sortBy",
      [
        "smart",
        "nameAsc",
        "nameDesc",
        "recentUsed",
        "recentInstalled",
        "mostUsed",
      ],
    ],
  ] as const) {
    if ((allowed as readonly unknown[]).includes(source[key]))
      Object.assign(settings, { [key]: source[key] });
  }
  if (typeof source.fontFamily === "string")
    settings.fontFamily = source.fontFamily.slice(0, 200);
  settings.categories = Array.isArray(source.categories)
    ? [
        ...new Set<string>(
          source.categories.filter(
            (s: unknown): s is string =>
              typeof s === "string" && s.length > 0 && s.length <= 80,
          ),
        ),
      ].slice(0, 200)
    : [...defaultSettings.categories];
  // Remote settings must never enable clipboard collection, alter privacy rules,
  // change WebDAV credentials, or import executable commands.
  const apps = obj.apps
    .slice(0, 10000)
    .filter(
      (a: unknown) =>
        a &&
        typeof a === "object" &&
        typeof (a as AppPreference).name === "string",
    )
    .map((a: AppPreference) => ({
      name: a.name.slice(0, 256),
      favorite: a.favorite === true,
      category:
        typeof a.category === "string" &&
        settings.categories!.includes(a.category)
          ? a.category
          : undefined,
      pinnedAt:
        typeof a.pinnedAt === "number" && Number.isFinite(a.pinnedAt)
          ? a.pinnedAt
          : undefined,
      folder: a.folder && typeof a.folder.id === "string" && a.folder.id.length > 0 && a.folder.id.length <= 100 && typeof a.folder.name === "string" && a.folder.name.trim()
        ? { id: a.folder.id, name: a.folder.name.trim().slice(0, 40) } : undefined,
    }));
  return {
    format: "qimiao-configuration",
    version: 1,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "",
    settings,
    apps,
  };
}
export function applyAppPreferences(
  apps: AppItem[],
  preferences: AppPreference[],
): AppItem[] {
  const byName = new Map(
    preferences.map((p) => [p.name.trim().toLocaleLowerCase(), p]),
  );
  return apps.map((app) => {
    const p = byName.get(app.name.trim().toLocaleLowerCase());
    return p
      ? {
          ...app,
          favorite: p.favorite,
          category: p.category,
          pinnedAt: p.pinnedAt,
          folder: p.folder,
        }
      : app;
  });
}
