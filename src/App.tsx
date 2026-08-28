import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Sparkles,
  Grid3X3,
  List,
  Star,
  Folder,
  RefreshCw,
  MoreHorizontal,
  Sun,
  Moon,
  Monitor,
  Plus,
  X,
  ChevronRight,
  Brain,
  AppWindow,
  Trash2,
  ScanSearch,
  Keyboard,
  Palette,
  Power,
  Plug,
  Check,
  ChevronLeft,
  Info,
  Contrast,
  RotateCw,
  SlidersHorizontal,
  Download,
  Upload,
  DatabaseBackup,
} from "lucide-react";
import {
  defaultSettings,
  type AppItem,
  type Settings,
} from "./types";
import {
  chooseApps,
  chooseFolder,
  desktopApps,
  existingAppPaths,
  exportBackup,
  getAutoStart,
  hideLauncher,
  importBackup,
  launchApp,
  loadAppIcon,
  openExternalUrl,
  openMacosPermission,
  readIcon,
  scanApps,
  setAutoStart,
  setGlobalHotkey,
  setTrayVisible,
  setWindowMaterial,
  suspendGlobalHotkeys,
} from "./tauri";
import { pinyin } from "pinyin-pro";

const load = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`无法保存 ${key}`, error);
  }
};
const newerVersion = (latest: string, current: string) => {
  const parts = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(latest),
    b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
};
const isWindows = navigator.userAgent.includes("Windows");
const isMacos = navigator.userAgent.includes("Mac");
document.documentElement.dataset.platform = isWindows
  ? "windows"
  : isMacos
    ? "macos"
    : "linux";
const windowsMaintenanceEntry = (name: string) => {
  const compact = name
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\-_()[\]]/g, "");
  return [
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
  ].some((word) => compact.includes(word)) ||
    [
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
    ].includes(compact);
};
const loadApps = (): AppItem[] =>
  load<AppItem[]>("float-apps", [])
    .filter((app) => !isWindows || !windowsMaintenanceEntry(app.name))
    .map((app) => ({
      ...app,
      icon:
        !app.icon || app.icon.startsWith("data:image/")
          ? `app:${app.path}`
          : app.icon,
    }));
const persistApps = (apps: AppItem[]) =>
  save(
    "float-apps",
    apps.map((app) => ({
      ...app,
      icon: app.icon?.startsWith("data:image/")
        ? `app:${app.path}`
        : app.icon || `app:${app.path}`,
    })),
  );
const APP_VERSION = "0.9.7";
const appIconUrl = new URL("../src-tauri/icons/128x128.png", import.meta.url)
  .href;
export default function App() {
  const [settings, setSettings] = useState(() => {
    const stored = load<Partial<Settings>>("float-settings", {});
    const merged = { ...defaultSettings, ...stored };
    return isWindows
      ? {
          ...merged,
          autoScanApps: false,
          scanOnLaunch: false,
          hotkey: stored.hotkey || "CommandOrControl+Alt+Space",
        }
      : merged;
  });
  const [apps, setApps] = useState<AppItem[]>(loadApps);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"apps" | "ai">("apps");
  const [page, setPage] = useState<"home" | "settings">("home");
  const [appPage, setAppPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState("全部");
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<{
    version: string;
    url: string;
  } | null>(null);
  const [importReview, setImportReview] = useState<{
    title: string;
    apps: AppItem[];
    selected: string[];
  } | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [categoryManager, setCategoryManager] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryStripRef = useRef<HTMLDivElement>(null);
  const wheelLock = useRef(false);
  const wheelDelta = useRef(0);
  const composingRef = useRef(false);
  const compositionEndedAt = useRef(0);
  const updateSettings = (p: Partial<Settings>) => {
    if (typeof p.autoStart === "boolean") {
      void setAutoStart(p.autoStart)
        .then((actual) => {
          setSettings((s) => ({ ...s, autoStart: actual }));
          showToast(actual ? "已开启开机启动" : "已关闭开机启动");
        })
        .catch((error) => showToast(`开机启动设置失败：${String(error)}`));
      return;
    }
    setSettings((s) => ({ ...s, ...p }));
  };
  function mergeApps(current: AppItem[], incoming: AppItem[]) {
    const merged = new Map(current.map((app) => [app.path.toLowerCase(), app]));
    for (const app of incoming) {
      const previous = merged.get(app.path.toLowerCase());
      merged.set(app.path.toLowerCase(), {
        ...app,
        manual: app.manual || previous?.manual || false,
        favorite: previous?.favorite ?? app.favorite,
        category: previous?.category,
        launchCount: previous?.launchCount ?? app.launchCount,
        lastUsed: previous?.lastUsed,
      });
    }
    return [...merged.values()];
  }
  async function refresh() {
    setBusy(true);
    try {
      const [found, existing] = await Promise.all([
        scanApps(settings.scanDirs),
        existingAppPaths(apps.map((app) => app.path)),
      ]);
      const existingSet = new Set(existing.map((path) => path.toLowerCase()));
      setApps((current) => current.filter((app) => existingSet.has(app.path.toLowerCase())));
      if (settings.confirmScanResults) {
        setImportReview({
          title:
            settings.language === "en"
              ? "Review scanned applications"
              : "确认要添加的扫描结果",
          apps: found,
          selected: found.map((app) => app.id),
        });
      } else {
        setApps((current) => mergeApps(current, found));
      }
      showToast(
        settings.language === "en"
          ? settings.confirmScanResults
            ? `${found.length} candidates found`
            : `Refreshed ${found.length} applications`
          : settings.confirmScanResults
            ? `发现 ${found.length} 个候选应用，请确认`
            : `已刷新 ${found.length} 个应用`,
      );
    } catch (e) {
      showToast(`扫描失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  function acceptImportReview() {
    if (!importReview) return;
    const selected = new Set(importReview.selected);
    const chosen = importReview.apps.filter((app) => selected.has(app.id));
    setApps((current) => mergeApps(current, chosen));
    setImportReview(null);
    showToast(
      settings.language === "en"
        ? `Added ${chosen.length} applications`
        : `已添加 ${chosen.length} 个应用`,
    );
  }
  function showToast(t: string) {
    setToast(t);
    window.setTimeout(() => setToast(""), 2200);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.material = settings.material;
    const dark =
      settings.theme === "dark" ||
      (settings.theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    void setWindowMaterial(settings.material, dark).catch(() => {});
    save("float-settings", settings);
  }, [settings]);
  useEffect(() => {
    document.documentElement.lang = settings.language === "en" ? "en" : "zh-CN";
    setTrayVisible(!settings.hideTray).catch(() => {});
  }, [settings.language, settings.hideTray]);
  useEffect(() => {
    getAutoStart()
      .then((enabled) =>
        setSettings((current) =>
          current.autoStart === enabled
            ? current
            : { ...current, autoStart: enabled },
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    setGlobalHotkey(settings.hotkey).catch(() =>
      showToast("快捷键被系统或其他应用占用"),
    );
  }, [settings.hotkey]);
  useEffect(() => persistApps(apps), [apps]);
  useEffect(() => {
    if (
      !isWindows &&
      settings.autoScanApps &&
      (!apps.length || settings.scanOnLaunch || apps.some((app) => !app.icon))
    )
      refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setCategoryManager(false);
        setAboutOpen(false);
        setAvailableUpdate(null);
        setImportReview(null);
        setClearConfirm(false);
        setPage("home");
        setMenu(null);
        setQuery("");
        void hideLauncher();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  useEffect(() => {
    const blockNativeMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (!(event.target as Element).closest(".app-card")) setMenu(null);
    };
    document.addEventListener("contextmenu", blockNativeMenu);
    return () => document.removeEventListener("contextmenu", blockNativeMenu);
  }, []);
  useEffect(() => {
    const prepareLauncher = () => {
      setPage("home");
      setMode("apps");
      setQuery("");
      setAppPage(0);
      setSelectedSearchIndex(0);
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    requestAnimationFrame(() => searchRef.current?.focus());
    if (
      !(window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__
    )
      return;
    let dispose: (() => void)[] = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      dispose = [
        await listen("launcher-shown", prepareLauncher),
        await listen("navigate-settings", () => setPage("settings")),
        await listen("check-update", () => void checkForUpdates()),
      ];
    });
    return () => dispose.forEach((fn) => fn());
  }, []);
  const smartScore = (a: AppItem) => {
    const now = Date.now(),
      day = 86400000;
    const recent = a.lastUsed ? Math.max(0, 35 - (now - a.lastUsed) / day) : 0;
    const installed = a.installedAt
      ? Math.max(0, 22 - (now - a.installedAt) / day)
      : 0;
    return (
      (a.favorite ? 28 : 0) +
      Math.log2(a.launchCount + 1) * 11 +
      recent +
      installed
    );
  };
  const recommended = useMemo(
    () => [...apps].sort((a, b) => smartScore(b) - smartScore(a)).slice(0, 7),
    [apps],
  );
  const categories = useMemo(
    () => [
      "全部",
      ...Array.from(
        new Set([
          ...settings.categories,
          ...(apps.map((a) => a.category).filter(Boolean) as string[]),
        ]),
      ),
    ],
    [apps, settings.categories],
  );
  const visible = useMemo(() => {
    let list = [...apps];
    if (category !== "全部") list = list.filter((a) => a.category === category);
    if (query && mode === "apps") {
      const q = query.toLowerCase().replace(/\s/g, "");
      list = list.filter((a) => {
        const text = `${a.name} ${a.searchTerms ?? ""}`;
        const full = pinyin(text, { toneType: "none" })
          .toLowerCase()
          .replace(/\s/g, "");
        const initials = pinyin(text, { pattern: "first", toneType: "none" })
          .toLowerCase()
          .replace(/\s/g, "");
        return (
          text.toLowerCase().includes(query.toLowerCase()) ||
          full.includes(q) ||
          initials.includes(q)
        );
      });
    }
    const sort = settings.sortBy;
    return list.sort((a, b) =>
      sort === "nameAsc"
        ? a.name.localeCompare(b.name)
        : sort === "nameDesc"
          ? b.name.localeCompare(a.name)
          : sort === "recentUsed"
            ? (b.lastUsed ?? 0) - (a.lastUsed ?? 0)
            : sort === "recentInstalled"
              ? (b.installedAt ?? 0) - (a.installedAt ?? 0)
              : sort === "mostUsed"
                ? b.launchCount - a.launchCount
                : smartScore(b) - smartScore(a),
    );
  }, [apps, query, mode, settings.sortBy, category]);
  const showRecommended =
    settings.showRecommendations && !query && mode === "apps";
  const libraryApps = showRecommended
    ? visible.filter((a) => !recommended.some((r) => r.id === a.id))
    : visible;
  const pageSize = showRecommended ? 21 : 28,
    pageCount =
      settings.viewMode === "list"
        ? 1
        : Math.max(1, Math.ceil(libraryApps.length / pageSize));
  const pageApps =
    settings.viewMode === "list"
      ? libraryApps
      : libraryApps.slice(appPage * pageSize, (appPage + 1) * pageSize);
  useEffect(() => setAppPage(0), [query, settings.viewMode]);
  useEffect(() => setSelectedSearchIndex(0), [query, category, appPage]);
  useEffect(() => {
    if (query)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('.app-card[aria-selected="true"]')
          ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
      );
  }, [selectedSearchIndex, query]);
  useEffect(() => {
    if (appPage >= pageCount) setAppPage(pageCount - 1);
  }, [pageCount, appPage]);
  async function open(app: AppItem) {
    setApps((x) =>
      x.map((a) =>
        a.id === app.id
          ? { ...a, launchCount: a.launchCount + 1, lastUsed: Date.now() }
          : a,
      ),
    );
    await launchApp(app.path);
    showToast(`正在打开 ${app.name}`);
  }
  async function checkForUpdates(silent = false) {
    if (!silent)
      showToast(
        settings.language === "en"
          ? "Checking for updates…"
          : `正在检查更新（当前 ${APP_VERSION}）…`,
      );
    try {
      const response = await fetch(
        "https://api.github.com/repos/amiaoapp/qimiao/releases/latest",
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!response.ok) throw new Error(`${response.status}`);
      const release = (await response.json()) as {
        tag_name?: string;
        html_url?: string;
      };
      const latest = (release.tag_name ?? "").replace(/^v/, "");
      if (latest && newerVersion(latest, APP_VERSION)) {
        if (release.html_url)
          setAvailableUpdate({ version: latest, url: release.html_url });
        showToast(
          settings.language === "en"
            ? `Version ${latest} is available`
            : `发现新版本 ${latest}`,
        );
      } else if (!silent)
        showToast(
          settings.language === "en"
            ? "qimiao is up to date"
            : "启喵已是最新版本",
        );
    } catch (error) {
      showToast(
        settings.language === "en"
          ? `Update check failed: ${String(error)}`
          : `检查更新失败：${String(error)}`,
      );
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void checkForUpdates(true), 1800);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addManualApp() {
    const selected = await chooseApps();
    if (!selected.length) return;
    setImportReview({
      title:
        settings.language === "en"
          ? "Review selected applications"
          : "确认手动添加的应用",
      apps: selected,
      selected: selected.map((app) => app.id),
    });
  }
  async function importDesktop() {
    const selected = await desktopApps();
    if (!selected.length) {
      showToast(
        settings.language === "en"
          ? "No application shortcuts found on either desktop"
          : "用户桌面和公共桌面中没有找到应用快捷方式",
      );
      return;
    }
    setImportReview({
      title:
        settings.language === "en"
          ? "Import desktop shortcuts"
          : "导入桌面快捷方式",
      apps: selected,
      selected: selected.map((app) => app.id),
    });
  }
  async function exportConfiguration() {
    const backup = {
      format: "qimiao-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...settings, apiKey: "" },
      apps,
    };
    try {
      const path = await exportBackup(JSON.stringify(backup, null, 2));
      if (path)
        showToast(
          settings.language === "en"
            ? "Backup exported (API key excluded)"
            : "备份已导出（不包含 API Key）",
        );
    } catch (error) {
      showToast(
        settings.language === "en"
          ? `Export failed: ${String(error)}`
          : `导出失败：${String(error)}`,
      );
    }
  }
  async function importConfiguration() {
    try {
      const raw = await importBackup();
      if (!raw) return;
      const backup = JSON.parse(raw) as {
        format?: string;
        settings?: Partial<Settings>;
        apps?: AppItem[];
      };
      if (backup.format !== "qimiao-backup" || !Array.isArray(backup.apps))
        throw new Error(
          settings.language === "en" ? "Invalid qimiao backup" : "不是有效的启喵备份",
        );
      const restoredSettings: Settings = {
        ...defaultSettings,
        ...backup.settings,
        apiKey: settings.apiKey,
      };
      setSettings(
        isWindows
          ? { ...restoredSettings, autoScanApps: false, scanOnLaunch: false }
          : restoredSettings,
      );
      setApps(
        backup.apps.filter(
          (app) => app && typeof app.name === "string" && typeof app.path === "string",
        ),
      );
      setCategory("全部");
      setAppPage(0);
      showToast(
        settings.language === "en" ? "Backup restored" : "备份已恢复",
      );
    } catch (error) {
      showToast(
        settings.language === "en"
          ? `Import failed: ${String(error)}`
          : `导入失败：${String(error)}`,
      );
    }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (page !== "home" || menu || categoryManager) return;
      const ime =
        event.isComposing ||
        composingRef.current ||
        event.keyCode === 229 ||
        Date.now() - compositionEndedAt.current < 140;
      if (ime) return;
      if (mode !== "apps" || !query.trim() || !pageApps.length) return;
      const columns = settings.viewMode === "grid" ? 7 : 1;
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const delta =
          event.key === "ArrowLeft"
            ? -1
            : event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowUp"
                ? -columns
                : columns;
        setSelectedSearchIndex((index) =>
          Math.max(0, Math.min(pageApps.length - 1, index + delta)),
        );
      } else if (event.key === "Enter") {
        event.preventDefault();
        void open(
          pageApps[Math.min(selectedSearchIndex, pageApps.length - 1)] ??
            pageApps[0],
        );
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [
    page,
    mode,
    query,
    menu,
    categoryManager,
    pageApps,
    selectedSearchIndex,
    settings.viewMode,
  ]);
  function toggleFavorite(id: string) {
    setApps((x) =>
      x.map((a) => (a.id === id ? { ...a, favorite: !a.favorite } : a)),
    );
    setMenu(null);
  }
  function groupApps(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const source = apps.find((a) => a.id === sourceId),
      target = apps.find((a) => a.id === targetId);
    if (!source || !target) return;
    const folder =
      target.category || source.category || `${target.name} 文件夹`;
    setApps((list) =>
      list.map((a) =>
        a.id === sourceId || a.id === targetId ? { ...a, category: folder } : a,
      ),
    );
    setCategory(folder);
    showToast(`已移动到「${folder}」`);
  }
  return (
    <main className="stage">
      <div className="ambient a1" />
      <div className="ambient a2" />
      <section className="launcher-shell">
        <div className="content">
          {availableUpdate && (
            <UpdateBanner
              language={settings.language}
              version={availableUpdate.version}
              onClose={() => setAvailableUpdate(null)}
              onDownload={() => void openExternalUrl(availableUpdate.url)}
            />
          )}
          {page === "home" ? (
            <>
              <Header
                language={settings.language}
                query={query}
                setQuery={setQuery}
                mode={mode}
                setMode={setMode}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                  compositionEndedAt.current = Date.now();
                }}
                inputRef={searchRef}
                theme={settings.theme}
                onTheme={() =>
                  updateSettings({
                    theme:
                      settings.theme === "system"
                        ? "light"
                        : settings.theme === "light"
                          ? "dark"
                          : "system",
                  })
                }
                onSettings={() => setPage("settings")}
                onRefresh={refresh}
                busy={busy}
              />
              <div className="category-nav">
                <button
                  className="category-arrow"
                  aria-label={settings.language === "en" ? "Previous categories" : "向前查看分类"}
                  onClick={() => categoryStripRef.current?.scrollBy({ left: -260, behavior: "smooth" })}
                >
                  <ChevronLeft />
                </button>
                <div
                  className="category-strip"
                  ref={categoryStripRef}
                  onWheel={(event) => {
                    const strip = categoryStripRef.current;
                    if (!strip) return;
                    event.preventDefault();
                    strip.scrollLeft += Math.abs(event.deltaY) > Math.abs(event.deltaX)
                      ? event.deltaY
                      : event.deltaX;
                  }}
                >
                  {categories.map((c) => (
                  <button
                    key={c}
                    className={category === c ? "active" : ""}
                    onClick={() => {
                      setCategory(c);
                      setAppPage(0);
                    }}
                  >
                    {settings.language === "en" && c === "全部" ? "All" : c}
                  </button>
                  ))}
                </div>
                <button
                  className="category-arrow"
                  aria-label={settings.language === "en" ? "Next categories" : "向后查看分类"}
                  onClick={() => categoryStripRef.current?.scrollBy({ left: 260, behavior: "smooth" })}
                >
                  <ChevronRight />
                </button>
                <button
                  className="add-category"
                  title={
                    settings.language === "en"
                      ? "Manage categories"
                      : "管理分类"
                  }
                  onClick={() => setCategoryManager(true)}
                >
                  <Plus />
                  {settings.language === "en" ? "Categories" : "管理分类"}
                </button>
              </div>
              {mode === "ai" && query ? (
                <AiPanel query={query} settings={settings} />
              ) : (
                <>
                  <section
                    className={`library launchpad ${showRecommended ? "has-recommend" : ""}`}
                    onWheel={(e) => {
                      wheelDelta.current +=
                        Math.abs(e.deltaX) > Math.abs(e.deltaY)
                          ? e.deltaX
                          : e.deltaY;
                      if (
                        wheelLock.current ||
                        Math.abs(wheelDelta.current) < 55
                      )
                        return;
                      const direction = wheelDelta.current > 0 ? 1 : -1;
                      wheelDelta.current = 0;
                      wheelLock.current = true;
                      setAppPage((p) =>
                        Math.max(0, Math.min(pageCount - 1, p + direction)),
                      );
                      window.setTimeout(() => {
                        wheelLock.current = false;
                        wheelDelta.current = 0;
                      }, 520);
                    }}
                  >
                    <div className="library-bar">
                      <span>
                        {query
                          ? `${visible.length} 个结果`
                          : showRecommended
                            ? "智能推荐 · 近期、常用与新安装"
                            : "所有应用"}
                      </span>
                      <div className="library-controls">
                        <select
                          value={settings.sortBy}
                          onChange={(e) =>
                            updateSettings({
                              sortBy: e.target.value as Settings["sortBy"],
                            })
                          }
                        >
                          <option value="smart">智能排序</option>
                          <option value="nameAsc">名称 A–Z</option>
                          <option value="nameDesc">名称 Z–A</option>
                          <option value="recentUsed">最近使用</option>
                          <option value="recentInstalled">最新安装</option>
                          <option value="mostUsed">最常使用</option>
                        </select>
                        <div className="view-switch">
                          <button
                            className={
                              settings.viewMode === "grid" ? "active" : ""
                            }
                            onClick={() => updateSettings({ viewMode: "grid" })}
                          >
                            <Grid3X3 />
                          </button>
                          <button
                            className={
                              settings.viewMode === "list" ? "active" : ""
                            }
                            onClick={() => updateSettings({ viewMode: "list" })}
                          >
                            <List />
                          </button>
                        </div>
                      </div>
                    </div>
                    {visible.length ? (
                      <>
                        {showRecommended && (
                          <div className="recommend-grid">
                            {recommended.map((a) => (
                              <AppCard
                                key={a.id}
                                app={a}
                                compact
                                onOpen={open}
                                onMenu={(id, x, y) => setMenu({ id, x, y })}
                                onGroup={groupApps}
                              />
                            ))}
                          </div>
                        )}
                        <div
                          key={appPage}
                          className={`${settings.viewMode} app-library page-enter`}
                        >
                          {pageApps.map((a, index) => (
                            <AppCard
                              key={a.id}
                              app={a}
                              selected={
                                Boolean(query.trim()) &&
                                index === selectedSearchIndex
                              }
                              onOpen={open}
                              onMenu={(id, x, y) => setMenu({ id, x, y })}
                              onGroup={groupApps}
                            />
                          ))}
                        </div>
                        {settings.viewMode === "grid" && (
                          <div className="pagination">
                            <button
                              disabled={appPage === 0}
                              onClick={() => setAppPage((p) => p - 1)}
                            >
                              <ChevronLeft />
                            </button>
                            {Array.from({ length: pageCount }, (_, i) => (
                              <button
                                aria-label={`第 ${i + 1} 页`}
                                key={i}
                                className={i === appPage ? "active" : ""}
                                onClick={() => setAppPage(i)}
                              />
                            ))}
                            <button
                              disabled={appPage === pageCount - 1}
                              onClick={() => setAppPage((p) => p + 1)}
                            >
                              <ChevronRight />
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <Empty
                        onRefresh={
                          isWindows ? () => void addManualApp() : refresh
                        }
                      />
                    )}
                  </section>
                </>
              )}
            </>
          ) : (
            <>
              <button className="back-home" onClick={() => setPage("home")}>
                <ChevronLeft />
                {settings.language === "en" ? "Back to launcher" : "返回启动台"}
              </button>
              <SettingsPage
                settings={settings}
                update={updateSettings}
                refresh={refresh}
                onAddApp={() => void addManualApp()}
                onImportDesktop={() => void importDesktop()}
                onClearApps={() => setClearConfirm(true)}
                onCheckUpdate={() => void checkForUpdates()}
                onAbout={() => setAboutOpen(true)}
                onExportBackup={() => void exportConfiguration()}
                onImportBackup={() => void importConfiguration()}
              />
            </>
          )}
        </div>
      </section>
      {menu && (
        <ContextMenu
          app={apps.find((a) => a.id === menu.id)!}
          categories={settings.categories}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onFavorite={() => toggleFavorite(menu.id)}
          onCategory={(category) => {
            setApps((x) =>
              x.map((a) => (a.id === menu.id ? { ...a, category } : a)),
            );
            setMenu(null);
          }}
          onRemove={() => {
            setApps((x) => x.filter((a) => a.id !== menu.id));
            setMenu(null);
          }}
        />
      )}
      {categoryManager && (
        <CategoryManager
          categories={settings.categories}
          onClose={() => setCategoryManager(false)}
          onSave={(next, renamed) => {
            updateSettings({ categories: next });
            setApps((list) =>
              list.map((app) =>
                app.category
                  ? {
                      ...app,
                      category:
                        renamed[app.category] ??
                        (next.includes(app.category)
                          ? app.category
                          : undefined),
                    }
                  : app,
              ),
            );
            if (category !== "全部")
              setCategory(
                renamed[category] ??
                  (next.includes(category) ? category : "全部"),
              );
            setCategoryManager(false);
          }}
        />
      )}
      {aboutOpen && (
        <AboutDialog
          language={settings.language}
          onClose={() => setAboutOpen(false)}
        />
      )}
      {importReview && (
        <ImportReviewDialog
          language={settings.language}
          title={importReview.title}
          apps={importReview.apps}
          selected={importReview.selected}
          onSelected={(selected) =>
            setImportReview((current) =>
              current ? { ...current, selected } : null,
            )
          }
          onClose={() => setImportReview(null)}
          onConfirm={acceptImportReview}
        />
      )}
      {clearConfirm && (
        <ConfirmDialog
          language={settings.language}
          onClose={() => setClearConfirm(false)}
          onConfirm={() => {
            setApps([]);
            setAppPage(0);
            setClearConfirm(false);
            showToast(
              settings.language === "en"
                ? "Application list cleared"
                : "已清空应用列表",
            );
          }}
        />
      )}
      {toast && (
        <div className="toast">
          <Check />
          {toast}
        </div>
      )}
    </main>
  );
}

function Header({
  language,
  query,
  setQuery,
  mode,
  setMode,
  onCompositionStart,
  onCompositionEnd,
  inputRef,
  theme,
  onTheme,
  onSettings,
  onRefresh,
  busy,
}: {
  language: Settings["language"];
  query: string;
  setQuery: (s: string) => void;
  mode: "apps" | "ai";
  setMode: (m: "apps" | "ai") => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  theme: Settings["theme"];
  onTheme: () => void;
  onSettings: () => void;
  onRefresh: () => void;
  busy: boolean;
}) {
  const en = language === "en";
  const placeholder = mode === "apps"
      ? en
        ? "Search apps"
        : "搜索应用"
      : en
        ? "Ask qimiao AI…"
        : "问启喵 AI…";
  return (
    <header className="launchpad-header">
      <div className="search-wrap">
        <Search />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={placeholder}
        />
        {query && (
          <button onClick={() => setQuery("")}>
            <X />
          </button>
        )}
        <kbd>⌥ Space</kbd>
      </div>
      <div className="header-actions">
        <div className="mode-switch">
          <button
            className={mode === "apps" ? "active" : ""}
            onClick={() => setMode("apps")}
          >
            <AppWindow />
            {en ? "Apps" : "应用"}
          </button>
          <button
            className={mode === "ai" ? "active" : ""}
            onClick={() => setMode("ai")}
          >
            <Brain />
            AI
          </button>
        </div>
        <button
          className="icon-btn"
          title={en ? `Theme: ${theme}` : `主题：${theme}`}
          onClick={onTheme}
        >
          <Contrast />
        </button>
        {!isWindows && (
          <button
            className="icon-btn"
            title={en ? "Refresh" : "刷新"}
            onClick={onRefresh}
          >
            <RotateCw className={busy ? "spin" : ""} />
          </button>
        )}
        <button
          className="icon-btn"
          title={en ? "Settings" : "设置"}
          onClick={onSettings}
        >
          <SlidersHorizontal />
        </button>
      </div>
    </header>
  );
}
function SectionTitle({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div className="title-icon">{icon}</div>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="section-action">{action}</div>}
    </div>
  );
}
function AppCard({
  app,
  compact,
  selected,
  onOpen,
  onMenu,
  onGroup,
}: {
  app: AppItem;
  compact?: boolean;
  selected?: boolean;
  onOpen: (a: AppItem) => void;
  onMenu: (id: string, x: number, y: number) => void;
  onGroup: (source: string, target: string) => void;
}) {
  const image =
    (app.icon?.startsWith("data:image/") ||
      app.icon?.startsWith("file:") ||
      app.icon?.startsWith("app:")) ??
    false;
  const [iconSrc, setIconSrc] = useState(
    app.icon?.startsWith("data:image/") ? app.icon : "",
  );
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let settled = false;
    setIconFailed(false);
    setIconSrc(app.icon?.startsWith("data:image/") ? app.icon : "");
    const timer = window.setTimeout(() => {
      if (active && !settled) setIconFailed(true);
    }, 5000);
    const done = (src: string) => {
      settled = true;
      clearTimeout(timer);
      if (active) {
        setIconSrc(src);
        setIconFailed(false);
      }
    };
    const fail = () => {
      settled = true;
      clearTimeout(timer);
      if (active) setIconFailed(true);
    };
    if (app.icon?.startsWith("file:"))
      readIcon(app.icon.slice(5)).then(done).catch(fail);
    if (app.icon?.startsWith("app:"))
      loadAppIcon(app.icon.slice(4), app.name).then(done).catch(fail);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [app.icon, app.name]);
  const fallback = app.icon?.split("|") ?? ["#667085", app.name?.[0] ?? "?"];
  const bg = image && !iconFailed ? "transparent" : fallback[0];
  const label = image ? (app.name?.[0] ?? "?") : fallback[1];
  return (
    <button
      draggable
      className={`app-card ${compact ? "compact" : ""} ${selected ? "keyboard-selected" : ""}`}
      aria-selected={selected || undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/miaoqi-app", app.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/miaoqi-app")) {
          e.preventDefault();
          e.currentTarget.classList.add("drop-target");
        }
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove("drop-target")}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("drop-target");
        onGroup(e.dataTransfer.getData("text/miaoqi-app"), app.id);
      }}
      onDoubleClick={() => onOpen(app)}
      onClick={() => onOpen(app)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(app.id, e.clientX, e.clientY);
      }}
    >
      <div
        className={`app-icon ${image && !iconFailed ? "native-icon" : ""}`}
        style={{ background: bg }}
      >
        {image && iconSrc ? (
          <img src={iconSrc} />
        ) : image && !iconFailed ? (
          <span className="icon-loading" />
        ) : (
          label
        )}
        <span className="shine" />
      </div>
      <div className="app-meta">
        <strong>{app.name || "未知应用"}</strong>
        {!compact && <span>{app.category ?? "应用"}</span>}
      </div>
      {app.favorite && <Star className="favorite" fill="currentColor" />}
      <MoreHorizontal
        className="more"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(app.id, r.left, r.bottom);
        }}
      />
    </button>
  );
}
function Empty({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="empty">
      <ScanSearch />
      <h3>还没有发现应用</h3>
      <p>刷新系统应用，或在设置中添加扫描目录。</p>
      <button className="primary" onClick={onRefresh}>
        {isWindows ? <Plus /> : <RefreshCw />}
        {isWindows ? "批量选择应用" : "开始扫描"}
      </button>
    </div>
  );
}
function ContextMenu({
  app,
  categories,
  x,
  y,
  onClose,
  onFavorite,
  onCategory,
  onRemove,
}: {
  app: AppItem;
  categories: string[];
  x: number;
  y: number;
  onClose: () => void;
  onFavorite: () => void;
  onCategory: (s: string) => void;
  onRemove: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    });
  }, [x, y, categories.length]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={menuRef} className="context-menu" style={position}>
        <div className="context-head">
          <div>
            <strong>{app.name}</strong>
            <span>{app.path}</span>
          </div>
        </div>
        <button onClick={onFavorite}>
          <Star />
          {app.favorite ? "取消收藏" : "收藏置顶"}
        </button>
        <div className="menu-label">移动到分类</div>
        {categories.map((x) => (
          <button key={x} onClick={() => onCategory(x)}>
            <Folder />
            {x}
            {app.category === x && <Check className="menu-check" />}
          </button>
        ))}
        <hr />
        <button className="danger" onClick={onRemove}>
          <Trash2 />
          从列表移除
        </button>
      </div>
    </>
  );
}
function CategoryManager({
  categories,
  onClose,
  onSave,
}: {
  categories: string[];
  onClose: () => void;
  onSave: (next: string[], renamed: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState(() =>
    categories.map((name, index) => ({
      id: `saved-${index}`,
      original: name,
      name,
    })),
  );
  const saveRows = () => {
    const valid = rows
      .map((row) => ({ ...row, name: row.name.trim() }))
      .filter((row) => row.name);
    const unique = valid.filter(
      (row, index) => valid.findIndex((x) => x.name === row.name) === index,
    );
    onSave(
      unique.map((row) => row.name),
      Object.fromEntries(
        unique
          .filter((row) => row.original && row.original !== row.name)
          .map((row) => [row.original, row.name]),
      ),
    );
  };
  return (
    <>
      <div className="scrim category-scrim" onClick={onClose} />
      <section className="category-manager">
        <header>
          <div>
            <h2>管理分类</h2>
            <p>添加、重命名或删除应用分类</p>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="category-editor-list">
          {rows.map((row) => (
            <div key={row.id}>
              <Folder />
              <input
                autoFocus={row.id.startsWith("new-")}
                value={row.name}
                placeholder="分类名称"
                onChange={(event) =>
                  setRows((list) =>
                    list.map((item) =>
                      item.id === row.id
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <button
                className="danger"
                title="删除分类"
                onClick={() =>
                  setRows((list) => list.filter((item) => item.id !== row.id))
                }
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
        <button
          className="category-add-row"
          onClick={() =>
            setRows((list) => [
              ...list,
              { id: `new-${Date.now()}`, original: "", name: "" },
            ])
          }
        >
          <Plus />
          添加分类
        </button>
        <footer>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={saveRows}>
            <Check />
            保存更改
          </button>
        </footer>
      </section>
    </>
  );
}
function AiPanel({ query, settings }: { query: string; settings: Settings }) {
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  async function ask() {
    if (!settings.apiKey) {
      setAnswer("请先在设置 → AI 服务中配置 API Key。你的密钥只保存在本机。");
      return;
    }
    setLoading(true);
    setAnswer("");
    try {
      const res = await fetch(settings.aiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.aiModel,
          messages: [{ role: "user", content: query }],
        }),
      });
      const data = await res.json();
      setAnswer(
        data.choices?.[0]?.message?.content ??
          data.error?.message ??
          "没有收到回答",
      );
    } catch (e) {
      setAnswer(`请求失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="ai-panel">
      <div className="ai-orb">
        <Brain />
      </div>
      <div>
        <span>启喵 AI · {settings.aiModel}</span>
        <h2>{query}</h2>
        {answer ? (
          <p>{answer}</p>
        ) : (
          <p className="muted">
            按下按钮，通过你配置的 AI 服务查询。API Key 仅保存在当前设备。
          </p>
        )}
        <button className="primary" onClick={ask} disabled={loading}>
          {loading ? <RefreshCw className="spin" /> : <Sparkles />}
          {loading ? "思考中…" : "开始查询"}
        </button>
      </div>
    </section>
  );
}
function SettingsPage({
  settings,
  update,
  refresh,
  onAddApp,
  onImportDesktop,
  onClearApps,
  onCheckUpdate,
  onAbout,
  onExportBackup,
  onImportBackup,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  refresh: () => void;
  onAddApp: () => void;
  onImportDesktop: () => void;
  onClearApps: () => void;
  onCheckUpdate: () => void;
  onAbout: () => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
}) {
  const en = settings.language === "en";
  async function addDir() {
    const dir = await chooseFolder();
    if (dir && !settings.scanDirs.includes(dir))
      update({ scanDirs: [...settings.scanDirs, dir] });
  }
  return (
    <div className="settings-page">
      <PageHead
        title={en ? "Settings" : "设置"}
        subtitle={en ? "Make qimiao work your way" : "让启喵按你的方式工作"}
      />
      <SettingSection
        icon={<AppWindow />}
        title={en ? "Language" : "语言 / Language"}
      >
        <div className="setting-row">
          <div>
            <strong>{en ? "Interface language" : "界面语言"}</strong>
            <span>
              {en
                ? "Switch between English and Chinese"
                : "支持中文和英文界面切换"}
            </span>
          </div>
          <Segment
            options={[
              ["zh", "中文"],
              ["en", "English"],
            ]}
            value={settings.language}
            onChange={(v) => update({ language: v as Settings["language"] })}
          />
        </div>
      </SettingSection>
      <SettingSection icon={<Palette />} title={en ? "Appearance" : "外观"}>
        <div className="setting-row">
          <div>
            <strong>{en ? "Color mode" : "显示模式"}</strong>
            <span>
              {en
                ? "Follow the system or choose a fixed theme"
                : "跟随系统，或固定明暗主题"}
            </span>
          </div>
          <Segment
            options={[
              ["system", en ? "System" : "系统", <Monitor />],
              ["light", en ? "Light" : "浅色", <Sun />],
              ["dark", en ? "Dark" : "深色", <Moon />],
            ]}
            value={settings.theme}
            onChange={(v) => update({ theme: v as Settings["theme"] })}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>{en ? "Window material" : "窗口材质"}</strong>
            <span>
              {settings.material === "liquid" && isMacos
                ? en
                  ? "Native liquid glass looks richer but uses more graphics memory"
                  : "原生液态玻璃效果更丰富，也会占用更多图形内存"
                : en
                  ? "Choose the background texture and transparency"
                  : "选择背景的质感和透明度"}
            </span>
          </div>
          <Segment
            options={[
              ["glass", en ? "Glass" : "毛玻璃"],
              ["liquid", en ? "Liquid" : "液态玻璃"],
              ["solid", en ? "Solid" : "纯色"],
            ]}
            value={settings.material}
            onChange={(v) => update({ material: v as Settings["material"] })}
          />
        </div>
        <ToggleRow
          title={en ? "Show recommendations" : "显示推荐应用"}
          desc={
            en
              ? "Show recently used, frequently used and newly installed apps in the first row"
              : "在第一行显示近期、常用与新安装应用"
          }
          checked={settings.showRecommendations}
          onChange={(v) => update({ showRecommendations: v })}
        />
      </SettingSection>
      <SettingSection
        icon={<ScanSearch />}
        title={
          isWindows
            ? en
              ? "Application list"
              : "应用列表"
            : en
              ? "App scanning"
              : "应用扫描"
        }
      >
        {!isWindows && (
          <>
            <ToggleRow
              title={en ? "Automatically scan system apps" : "自动扫描系统应用"}
              desc={
                en
                  ? "Turn this off to maintain a small launcher list manually"
                  : "关闭后可只维护自己手动添加的小型应用列表"
              }
              checked={settings.autoScanApps}
              onChange={(enabled) => update({ autoScanApps: enabled })}
            />
            <ToggleRow
              title={en ? "Scan at launch" : "启动时扫描"}
              desc={
                en
                  ? "Refresh the app list whenever qimiao opens"
                  : "每次打开启喵时更新应用列表"
              }
              checked={settings.scanOnLaunch}
              onChange={(v) => update({ scanOnLaunch: v })}
            />
            <ToggleRow
              title={en ? "Review scan results" : "扫描结果二次确认"}
              desc={
                en
                  ? "Show a selection dialog after each refresh; turn off to import automatically"
                  : "开启后每次刷新都弹出选择窗口；关闭后直接导入"
              }
              checked={settings.confirmScanResults}
              onChange={(v) => update({ confirmScanResults: v })}
            />
          </>
        )}
        <div className="setting-row">
          <div>
            <strong>{en ? "Manual application list" : "手动管理应用"}</strong>
            <span>
              {en
                ? "Select multiple executables or shortcuts, or import both Windows desktop folders"
                : "可一次多选应用或快捷方式，也可导入用户桌面与公共桌面"}
            </span>
          </div>
          <div className="setting-actions">
            <button className="secondary" onClick={onAddApp}>
              <Plus />
              {en ? "Select apps" : "批量选择"}
            </button>
            {isWindows && (
              <button className="secondary" onClick={onImportDesktop}>
                <AppWindow />
                {en ? "Import desktop" : "导入桌面"}
              </button>
            )}
            <button
              className="secondary danger-text"
              onClick={onClearApps}
            >
              <Trash2 />
              {en ? "Clear list" : "清空列表"}
            </button>
          </div>
        </div>
        {!isWindows && (
          <div className="setting-row column">
            <div>
              <strong>{en ? "Additional folders" : "额外扫描目录"}</strong>
              <span>
                {en
                  ? "Included when you scan manually or enable automatic scanning"
                  : "手动刷新或开启自动扫描时，会一并扫描这些目录"}
              </span>
            </div>
            <div className="dir-list">
              {settings.scanDirs.map((d) => (
                <div key={d}>
                  <Folder />
                  <span>{d}</span>
                  <button
                    onClick={() =>
                      update({
                        scanDirs: settings.scanDirs.filter((x) => x !== d),
                      })
                    }
                  >
                    <X />
                  </button>
                </div>
              ))}
              <button className="add-dir" onClick={addDir}>
                <Plus />
                {en ? "Add folder" : "添加目录"}
              </button>
              <button className="secondary" onClick={refresh}>
                <RefreshCw />
                {en ? "Scan and review" : "扫描并选择"}
              </button>
            </div>
          </div>
        )}
      </SettingSection>
      <SettingSection icon={<Keyboard />} title={en ? "Hotkey" : "快捷键"}>
        <div className="setting-row">
          <div>
            <strong>{en ? "Show or hide qimiao" : "显示或隐藏启喵"}</strong>
            <span>
              {en
                ? "Click the button, then press a new shortcut"
                : "点击右侧按钮，然后按下新的组合键"}
            </span>
          </div>
          <HotkeyRecorder
            value={settings.hotkey}
            onChange={(hotkey) => update({ hotkey })}
          />
        </div>
      </SettingSection>
      <SettingSection icon={<Brain />} title={en ? "AI service" : "AI 服务"}>
        <div className="form-grid">
          <label>
            {en ? "Provider" : "服务商"}
            <input
              value={settings.aiProvider}
              onChange={(e) => update({ aiProvider: e.target.value })}
            />
          </label>
          <label>
            {en ? "Model" : "模型"}
            <input
              value={settings.aiModel}
              onChange={(e) => update({ aiModel: e.target.value })}
            />
          </label>
          <label className="wide">
            {en ? "API endpoint" : "API 地址"}
            <input
              value={settings.aiEndpoint}
              onChange={(e) => update({ aiEndpoint: e.target.value })}
            />
          </label>
          <label className="wide">
            API Key
            <input
              type="password"
              placeholder="sk-••••••••"
              value={settings.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
          </label>
        </div>
      </SettingSection>
      <SettingSection icon={<Power />} title={en ? "System" : "系统"}>
        <ToggleRow
          title={en ? "Launch at login" : "开机自动启动"}
          desc={
            en ? "Run in the background after login" : "登录系统后在后台运行"
          }
          checked={settings.autoStart}
          onChange={(v) => update({ autoStart: v })}
        />
        <ToggleRow
          title={en ? "Hide menu bar icon" : "隐藏菜单栏图标"}
          desc={
            en ? "The global hotkey can still open qimiao" : "仍可使用快捷键唤起"
          }
          checked={settings.hideTray}
          onChange={(v) => update({ hideTray: v })}
        />
        <div className="setting-row">
          <div>
            <strong>{en ? "Check for updates" : "检查更新"}</strong>
            <span>
              {en ? "Current version" : "当前版本"} {APP_VERSION}
            </span>
          </div>
          <button className="secondary" onClick={onCheckUpdate}>
            <RefreshCw />
            {en ? "Check now" : "立即检查"}
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>{en ? "About qimiao" : "关于启喵"}</strong>
            <span>
              {en
                ? "Version, project and copyright information"
                : "版本、项目与版权信息"}
            </span>
          </div>
          <button className="secondary" onClick={onAbout}>
            <Info />
            {en ? "About" : "关于"}
          </button>
        </div>
      </SettingSection>
      <SettingSection
        icon={<DatabaseBackup />}
        title={en ? "Backup and restore" : "配置备份与恢复"}
      >
        <div className="setting-row">
          <div>
            <strong>{en ? "Portable configuration" : "迁移全部配置"}</strong>
            <span>
              {en
                ? "Export apps, categories and settings. API keys are never included."
                : "导出应用、分类与设置；为安全起见不会包含 API Key"}
            </span>
          </div>
          <div className="setting-actions">
            <button className="secondary" onClick={onExportBackup}>
              <Download />
              {en ? "Export" : "导出备份"}
            </button>
            <button className="secondary" onClick={onImportBackup}>
              <Upload />
              {en ? "Import" : "导入恢复"}
            </button>
          </div>
        </div>
      </SettingSection>
    </div>
  );
}
function PageHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
function SettingSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="setting-section">
      <div className="setting-title">
        <span>{icon}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <span>{desc}</span>
      </div>
      <button
        className={`toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}
function Segment({
  options,
  value,
  onChange,
}: {
  options: (string | React.ReactNode)[][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="segment">
      {options.map((o) => (
        <button
          key={o[0] as string}
          className={value === o[0] ? "active" : ""}
          onClick={() => onChange(o[0] as string)}
        >
          {o[2]}
          {o[1]}
        </button>
      ))}
    </div>
  );
}
function HotkeyRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const lastControl = useRef(0);
  async function apply(next: string) {
    setRecording(false);
    setError("");
    try {
      await setGlobalHotkey(next, value);
      onChange(next);
    } catch (reason) {
      setError(String(reason));
    }
  }
  async function begin() {
    setError("");
    lastControl.current = 0;
    try {
      await suspendGlobalHotkeys();
      setRecording(true);
    } catch (reason) {
      setError(String(reason));
    }
  }
  async function stop() {
    setRecording(false);
    await setGlobalHotkey(value).catch(() => {});
  }
  function capture(e: KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      stop();
      return;
    }
    if (e.key === "Control") {
      const now = Date.now();
      if (now - lastControl.current < 430) {
        apply("DoubleControl");
        lastControl.current = 0;
      } else lastControl.current = now;
      return;
    }
    const mods: string[] = [];
    if (e.metaKey || e.ctrlKey) mods.push("CommandOrControl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (!mods.length) return;
    const ignored = ["Meta", "Alt", "Shift"];
    if (ignored.includes(e.key)) return;
    const key =
      e.code === "Space"
        ? "Space"
        : e.key.length === 1
          ? e.key.toUpperCase()
          : e.key;
    apply([...mods, key].join("+"));
  }
  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => capture(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, value]);
  const display =
    value === "DoubleControl"
      ? "双击 Ctrl"
      : value.replace("CommandOrControl", "⌘ / Ctrl").split("+").join("  +  ");
  return (
    <div className="hotkey-stack">
      <div className="hotkey-control">
        <button
          className={`hotkey-recorder ${recording ? "recording" : ""}`}
          onClick={begin}
        >
          {recording ? "请按组合键或双击 Ctrl…" : display}
        </button>
        <select
          aria-label="快捷键预设"
          value={value}
          onChange={(e) => apply(e.target.value)}
        >
          <option value="Alt+Space">⌥ Space</option>
          <option value="CommandOrControl+Alt+Space">Ctrl/⌘ ⌥ Space</option>
          <option value="CommandOrControl+Space">⌘ Space</option>
          <option value="CommandOrControl+Shift+Space">⌘ ⇧ Space</option>
          <option value="Alt+Shift+Space">⌥ ⇧ Space</option>
          <option value="DoubleControl">双击 Ctrl</option>
        </select>
      </div>
      {value === "DoubleControl" && (
        <div className="permission-hint">
          <span>双击修饰键需要 macOS 输入监控权限</span>
          <button onClick={() => openMacosPermission("input")}>
            打开输入监控
          </button>
          <button onClick={() => openMacosPermission("accessibility")}>
            打开辅助功能
          </button>
        </div>
      )}
      {error && <span className="hotkey-error">{error}</span>}
    </div>
  );
}
/* Plugin system removed in 0.9.5. The legacy UI is kept commented in this
   source revision only to make older local backups easier to migrate. */
/*
function PluginsPage({
  settings,
  update,
  installedCommands,
  onCommands,
  onRun,
  onRefresh,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  installedCommands: ExtensionCommand[];
  onCommands: (commands: ExtensionCommand[]) => void;
  onRun: (command: ExtensionCommand) => Promise<void>;
  onRefresh: () => void;
}) {
  const en = settings.language === "en";
  const [tab, setTab] = useState<"installed" | "store" | "builtin">(
    "installed",
  );
  const [active, setActive] = useState<string | null>(null);
  const [store, setStore] = useState<ExtensionCatalogEntry[]>([]);
  const [storeQuery, setStoreQuery] = useState("");
  const [storeBusy, setStoreBusy] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const installedNames = new Set(
    installedCommands.map((command) => command.extensionName),
  );
  const plugins: Array<{
    id: Exclude<PluginKind, "supercmd">;
    name: string;
    desc: string;
    icon: string;
  }> = [
    {
      id: "calculator",
      name: en ? "Calculator" : "计算器",
      desc: en ? "Evaluate mathematical expressions" : "计算数学表达式",
      icon: "∑",
    },
    {
      id: "clipboard",
      name: en ? "Clipboard" : "剪贴板",
      desc: en ? "Read the current clipboard content" : "读取当前剪贴板内容",
      icon: "⌘",
    },
    {
      id: "links",
      name: en ? "Quick Links" : "快速链接",
      desc: en ? "Find and open website shortcuts" : "搜索并打开网站快捷方式",
      icon: "↗",
    },
    {
      id: "translate",
      name: en ? "Translate" : "翻译",
      desc: en ? "Translate from the search box" : "直接在搜索框中翻译",
      icon: en ? "A" : "译",
    },
  ];
  const setShortcut = (kind: PluginKind, value: string) => {
    const key = value.slice(-1).toUpperCase();
    if (!key) return;
    const duplicate = (
      Object.entries(settings.pluginShortcuts) as [PluginKind, string][]
    ).find(([id, shortcut]) => id !== kind && shortcut.toUpperCase() === key);
    if (duplicate) return;
    update({ pluginShortcuts: { ...settings.pluginShortcuts, [kind]: key } });
  };
  async function loadStore(query = "") {
    setStoreBusy(true);
    try {
      setStore(await fetchExtensionCatalog(query));
    } catch {
      setStore([]);
    } finally {
      setStoreBusy(false);
    }
  }
  async function install(name: string) {
    setInstalling(name);
    try {
      onCommands(await installExtension(name));
      setTab("installed");
    } catch (error) {
      alert(
        `${en ? "Extension installation failed" : "扩展安装失败"}：${String(error)}`,
      );
    } finally {
      setInstalling(null);
    }
  }
  async function remove(name: string) {
    setInstalling(name);
    try {
      onCommands(await uninstallExtension(name));
      Object.keys(localStorage)
        .filter(
          (key) =>
            key.includes(`:${name}:`) || key.endsWith(`:${name}`),
        )
        .forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      alert(`${en ? "Uninstall failed" : "卸载失败"}：${String(error)}`);
    } finally {
      setInstalling(null);
    }
  }
  async function run(command: ExtensionCommand) {
    try {
      await onRun(command);
    } catch (error) {
      alert(`${en ? "Extension failed to start" : "扩展启动失败"}：${String(error)}`);
    }
  }
  useEffect(() => {
    if (tab === "store" && !store.length) void loadStore();
  }, [tab]);
  return (
    <div className="settings-page extensions-page">
      <PageHead
        title={en ? "Extensions" : "扩展"}
        subtitle={
          en
            ? "Install and run Raycast-format extensions inside qimiao"
            : "在启喵内部安装并运行 Raycast 格式扩展"
        }
      />
      <div className="extension-tabs">
        <button
          className={tab === "installed" ? "active" : ""}
          onClick={() => setTab("installed")}
        >
          {en ? "Installed Commands" : "已安装命令"}
          <b>{installedCommands.length}</b>
        </button>
        <button
          className={tab === "store" ? "active" : ""}
          onClick={() => setTab("store")}
        >
          {en ? "Extension Store" : "插件商店"}
        </button>
        <button
          className={tab === "builtin" ? "active" : ""}
          onClick={() => setTab("builtin")}
        >
          {en ? "Built-in Tools" : "内置工具"}
        </button>
      </div>
      {tab === "installed" ? (
        <>
          <div className="supercmd-hero">
            <div>
              <Plug />
            </div>
            <section>
              <h2>{en ? "qimiao Extension Runtime" : "启喵扩展运行时"}</h2>
              <p>
                {en
                  ? "Extensions are installed to qimiao and run with its built-in Raycast API compatibility layer. No external app is launched."
                  : "扩展直接安装到启喵，并由内置 Raycast API 兼容层运行，不会调用任何外部程序。"}
              </p>
              <div>
                <label className="compact-trigger">
                  {en ? "Trigger" : "触发键"}
                  <input
                    maxLength={1}
                    value={settings.pluginShortcuts.supercmd}
                    onChange={(event) =>
                      setShortcut("supercmd", event.target.value)
                    }
                  />
                </label>
                <button className="secondary" onClick={onRefresh}>
                  <RefreshCw />
                  {en ? "Refresh" : "刷新"}
                </button>
                <button className="primary" onClick={() => setTab("store")}>
                  <Plus />
                  {en ? "Browse Store" : "浏览商店"}
                </button>
              </div>
            </section>
          </div>
          {installedCommands.length ? (
            <div className="extension-command-list">
              {installedCommands.map((command) => (
                <div
                  className="extension-command-row"
                  role="button"
                  tabIndex={0}
                  key={command.id}
                  onClick={() => void run(command)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void run(command);
                  }}
                >
                  {command.icon ? <img src={command.icon} /> : <span>⌁</span>}
                  <div>
                    <strong>{command.title}</strong>
                    <small>
                      {command.extensionTitle}
                      {command.description ? ` · ${command.description}` : ""}
                    </small>
                  </div>
                  <em>{command.mode}</em>
                  <button
                    className="extension-remove"
                    title={en ? "Uninstall" : "卸载"}
                    disabled={installing === command.extensionName}
                    onClick={(event) => {
                      event.stopPropagation();
                      void remove(command.extensionName);
                    }}
                  >
                    <Trash2 />
                  </button>
                  <ChevronRight />
                </div>
              ))}
            </div>
          ) : (
            <div className="extension-empty">
              <Plug />
              <h3>{en ? "No extensions installed" : "尚未安装扩展"}</h3>
              <p>
                {en
                  ? "Browse the store and install an extension directly into qimiao."
                  : "前往商店，把扩展直接安装到启喵。"}
              </p>
              <button className="primary" onClick={() => setTab("store")}>
                {en ? "Browse Extension Store" : "浏览扩展商店"}
              </button>
            </div>
          )}
        </>
      ) : tab === "store" ? (
        <>
          <form
            className="extension-search"
            onSubmit={(event) => {
              event.preventDefault();
              void loadStore(storeQuery);
            }}
          >
            <Search />
            <input
              value={storeQuery}
              onChange={(event) => setStoreQuery(event.target.value)}
              placeholder={
                en
                  ? "Search Raycast-format extensions"
                  : "搜索 Raycast 格式扩展"
              }
            />
            <button className="primary" disabled={storeBusy}>
              {storeBusy ? <RefreshCw className="spin" /> : <Search />}
              {en ? "Search" : "搜索"}
            </button>
          </form>
          <div className="store-grid">
            {store.map((item) => (
              <article key={item.id}>
                {item.iconUrl ? <img src={item.iconUrl} /> : <span>⌁</span>}
                <div>
                  <h3>{item.title}</h3>
                  <small>
                    {item.author} · {item.installCount ?? 0}{" "}
                    {en ? "installs" : "次安装"}
                  </small>
                  <p>{item.description}</p>
                </div>
                <button
                  className="secondary"
                  disabled={installing === item.name}
                  onClick={() =>
                    void (installedNames.has(item.name)
                      ? remove(item.name)
                      : install(item.name))
                  }
                >
                  {installing === item.name
                    ? en
                      ? "Installing…"
                      : "安装中…"
                    : installedNames.has(item.name)
                      ? en
                        ? "Uninstall"
                        : "卸载"
                      : en
                        ? "Install in qimiao"
                        : "安装到启喵"}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="plugin-hero">
            <div>
              <Plug />
            </div>
            <section>
              <h2>{en ? "Search-box command mode" : "搜索框命令模式"}</h2>
              <p>
                {en
                  ? "Each tool has a one-key trigger. For example, press T to translate."
                  : "每个工具可配置一个单键，例如在搜索框按 T 直接进入翻译。"}
              </p>
              <button className="primary" onClick={() => openPluginDirectory()}>
                <Folder />
                {en ? "Open local plugin folder" : "打开本地插件目录"}
              </button>
            </section>
          </div>
          <div className="plugin-grid">
            {plugins.map((p) => (
              <article className="plugin-card" key={p.id}>
                <button className="plugin-open" onClick={() => setActive(p.id)}>
                  <span className="plugin-icon">{p.icon}</span>
                  <div>
                    <h3>{p.name}</h3>
                    <p>{p.desc}</p>
                  </div>
                  <ChevronRight />
                </button>
                <label className="plugin-shortcut">
                  <span>{en ? "Trigger" : "触发键"}</span>
                  <input
                    maxLength={1}
                    value={settings.pluginShortcuts[p.id]}
                    onChange={(event) => setShortcut(p.id, event.target.value)}
                  />
                </label>
              </article>
            ))}
          </div>
          {active && (
            <PluginTool
              kind={active}
              settings={settings}
              onClose={() => setActive(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
function PluginTool({
  kind,
  settings,
  onClose,
}: {
  kind: string;
  settings: Settings;
  onClose: () => void;
}) {
  const en = settings.language === "en";
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<{ name: string; url: string }[]>(() =>
    load("miaoqi-links", []),
  );
  const title =
    kind === "calculator"
      ? en
        ? "Calculator"
        : "计算器"
      : kind === "clipboard"
        ? en
          ? "Clipboard"
          : "剪贴板"
        : kind === "links"
          ? en
            ? "Quick Links"
            : "快速链接"
          : en
            ? "Translate"
            : "翻译";
  async function run() {
    setBusy(true);
    try {
      if (kind === "calculator") {
        if (!new RegExp("^[\\d\\s+\\-/*().%^]+$").test(input))
          throw new Error(
            en
              ? "Only mathematical expressions are allowed"
              : "仅支持数学表达式",
          );
        const value = Function(
          `"use strict";return (${input.replace(/\^/g, "**")})`,
        )();
        setResult(String(value));
      } else if (kind === "clipboard")
        setResult(
          (await readClipboardText()) ||
            (en ? "Clipboard is empty" : "剪贴板为空"),
        );
      else if (kind === "translate") {
        if (!settings.apiKey)
          throw new Error(
            en
              ? "Configure an API key in Settings first"
              : "请先在设置中配置 API Key",
          );
        const response = await fetch(settings.aiEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify({
            model: settings.aiModel,
            messages: [
              {
                role: "user",
                content: `Translate the following text to ${en ? "Chinese" : "English"}. Return only the translation:\n${input}`,
              },
            ],
          }),
        });
        const data = await response.json();
        setResult(
          data.choices?.[0]?.message?.content ??
            data.error?.message ??
            "No response",
        );
      }
    } catch (error) {
      setResult(String(error));
    } finally {
      setBusy(false);
    }
  }
  function addLink() {
    const [name, url] = input.split("|").map((x) => x.trim());
    if (!name || !/^https?:\/\//.test(url)) {
      setResult(
        en
          ? "Use: Name | https://example.com"
          : "格式：名称 | https://example.com",
      );
      return;
    }
    const next = [...links, { name, url }];
    setLinks(next);
    save("miaoqi-links", next);
    setInput("");
  }
  return (
    <>
      <div className="scrim category-scrim" onClick={onClose} />
      <section className="plugin-tool">
        <header>
          <h2>{title}</h2>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        {kind === "links" ? (
          <>
            <div className="quick-links">
              {links.map((link, index) => (
                <div key={`${link.url}-${index}`}>
                  <button onClick={() => openExternalUrl(link.url)}>
                    <span>{link.name}</span>
                    <small>{link.url}</small>
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      const next = links.filter((_, i) => i !== index);
                      setLinks(next);
                      save("miaoqi-links", next);
                    }}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                en ? "Name | https://example.com" : "名称 | https://example.com"
              }
            />
            <button className="primary" onClick={addLink}>
              <Plus />
              {en ? "Add link" : "添加链接"}
            </button>
          </>
        ) : (
          <>
            <textarea
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                kind === "calculator"
                  ? "(12 + 8) * 3"
                  : kind === "clipboard"
                    ? en
                      ? "Click Read clipboard"
                      : "点击读取剪贴板"
                    : en
                      ? "Enter text to translate"
                      : "输入要翻译的文字"
              }
            />
            <button className="primary" onClick={run} disabled={busy}>
              {busy ? (
                <RefreshCw className="spin" />
              ) : kind === "clipboard" ? (
                <ClipboardIcon />
              ) : (
                <Sparkles />
              )}
              {kind === "clipboard"
                ? en
                  ? "Read clipboard"
                  : "读取剪贴板"
                : en
                  ? "Run"
                  : "执行"}
            </button>
            {result && <pre>{result}</pre>}
          </>
        )}
      </section>
    </>
  );
}
function PluginCommandPanel({
  kind,
  result,
  busy,
  language,
  onRun,
  onExit,
}: {
  kind: PluginKind;
  result: string;
  busy: boolean;
  language: Settings["language"];
  onRun: () => void;
  onExit: () => void;
}) {
  const en = language === "en",
    plugin = pluginNames[kind];
  return (
    <section className="plugin-command-panel">
      <div className="plugin-command-icon">{plugin.icon}</div>
      <div className="plugin-command-body">
        <span>{en ? plugin.en : plugin.zh}</span>
        <h2>{en ? "Search-box command mode" : "搜索框命令模式"}</h2>
        <p>
          {result ||
            (en
              ? "Type above and press Enter to run. Press Esc to return to app search."
              : "在上方输入内容并按回车执行，按 Esc 返回应用搜索。")}
        </p>
        <div>
          <button className="primary" disabled={busy} onClick={onRun}>
            {busy ? <RefreshCw className="spin" /> : <Sparkles />}
            {en ? "Run" : "执行"}
          </button>
          <button className="secondary" onClick={onExit}>
            {en ? "Exit" : "退出"}
          </button>
        </div>
      </div>
    </section>
  );
}
*/
function AboutDialog({
  language,
  onClose,
}: {
  language: Settings["language"];
  onClose: () => void;
}) {
  const en = language === "en";
  return (
    <>
      <div className="scrim category-scrim" onClick={onClose} />
      <section className="about-dialog">
        <button className="about-close" onClick={onClose}>
          <X />
        </button>
        <img src={appIconUrl} alt="启喵" />
        <h2>{en ? "qimiao" : "启喵"}</h2>
        <strong>v{APP_VERSION}</strong>
        <p>
          {en
            ? "A smart cross-platform app launcher by APP Miao."
            : "APP喵旗下的智能跨平台应用启动器。"}
        </p>
        <button
          className="secondary"
          onClick={() => openExternalUrl("https://github.com/amiaoapp/qimiao")}
        >
          <ChevronRight />
          {en ? "View on GitHub" : "访问 GitHub"}
        </button>
      </section>
    </>
  );
}
function UpdateBanner({
  language,
  version,
  onClose,
  onDownload,
}: {
  language: Settings["language"];
  version: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const en = language === "en";
  return (
    <section className="update-banner" role="status">
      <span className="update-arrow">↑</span>
      <div>
        <strong>{en ? `qimiao ${version} is available` : `启喵 ${version} 已发布`}</strong>
        <small>
          {en
            ? `Current version ${APP_VERSION}. Updating is recommended.`
            : `当前版本 ${APP_VERSION}，建议更新后继续使用。`}
        </small>
      </div>
      <button className="primary" onClick={onDownload}>
        {en ? "View update" : "查看更新"}
      </button>
      <button className="update-close" onClick={onClose} aria-label="关闭">
        <X />
      </button>
    </section>
  );
}

function ImportReviewDialog({
  language,
  title,
  apps,
  selected,
  onSelected,
  onClose,
  onConfirm,
}: {
  language: Settings["language"];
  title: string;
  apps: AppItem[];
  selected: string[];
  onSelected: (ids: string[]) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const en = language === "en";
  const picked = new Set(selected);
  return (
    <>
      <div className="scrim category-scrim" />
      <section className="import-review" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>{title}</h2>
            <p>
              {en
                ? "Only checked items will be added. Nothing is added until you confirm."
                : "只有勾选项会加入启动器，确认前不会修改当前列表。"}
            </p>
          </div>
          <button onClick={onClose} aria-label="关闭"><X /></button>
        </header>
        <div className="review-toolbar">
          <strong>{en ? `${selected.length} of ${apps.length} selected` : `已选 ${selected.length} / ${apps.length}`}</strong>
          <button onClick={() => onSelected(apps.map((app) => app.id))}>{en ? "Select all" : "全选"}</button>
          <button onClick={() => onSelected([])}>{en ? "Select none" : "全不选"}</button>
        </div>
        <div className="review-list">
          {apps.map((app) => (
            <label key={app.id}>
              <input
                type="checkbox"
                checked={picked.has(app.id)}
                onChange={() =>
                  onSelected(
                    picked.has(app.id)
                      ? selected.filter((id) => id !== app.id)
                      : [...selected, app.id],
                  )
                }
              />
              <span>{app.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{app.name}</strong><small>{app.path}</small></div>
            </label>
          ))}
        </div>
        <footer>
          <button className="secondary" onClick={onClose}>{en ? "Cancel" : "取消"}</button>
          <button className="primary" disabled={!selected.length} onClick={onConfirm}>
            <Check />{en ? `Add ${selected.length}` : `添加 ${selected.length} 个`}
          </button>
        </footer>
      </section>
    </>
  );
}

function ConfirmDialog({
  language,
  onClose,
  onConfirm,
}: {
  language: Settings["language"];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const en = language === "en";
  return (
    <>
      <div className="scrim category-scrim" />
      <section className="confirm-dialog" role="dialog" aria-modal="true">
        <h2>{en ? "Clear application list?" : "清空应用列表？"}</h2>
        <p>{en ? "Categories and application usage data in the list will also be removed." : "列表中的分类关系和应用使用记录也会一并移除。"}</p>
        <footer>
          <button className="secondary" onClick={onClose}>{en ? "Cancel" : "取消"}</button>
          <button className="primary danger-button" onClick={onConfirm}>{en ? "Clear list" : "确认清空"}</button>
        </footer>
      </section>
    </>
  );
}
function ClipboardIcon() {
  return <span aria-hidden>⌘</span>;
}
