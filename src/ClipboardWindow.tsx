import { useEffect, useRef, useState } from "react";
import { Search, X, PanelLeft, Columns2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ClipboardPane from "./ClipboardPane";
import WindowResizeHandles from "./WindowResizeHandles";
import { useClipboardClient } from "./useClipboardBridge";
import { normalizeSettings } from "./sync-core";
import { normalizeClipboardWindow, type ClipboardWindowPreferences } from "./clipboard-window-state";
import { configureClipboardWindow, hideLauncher, setWindowMaterial, startWindowDrag } from "./tauri";
import { fontStackFor } from "./appearance";
import "./clipboard-window.css";

function stored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}
export default function ClipboardWindow() {
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  function showToast(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }
  const client = useClipboardClient(normalizeSettings(stored("float-settings", {})), showToast);
  const settings = client.settings;
  const en = settings.language === "en";
  const [preferences, setPreferences] = useState(() => normalizeClipboardWindow(stored("qimiao-clipboard-window", {})));
  const latestPrefs = useRef(preferences);
  latestPrefs.current = preferences;
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const compositionEnded = useRef(0);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  function updatePreferences(patch: Partial<ClipboardWindowPreferences>, resize = false) {
    const next = normalizeClipboardWindow({ ...latestPrefs.current, ...patch });
    latestPrefs.current = next;
    setPreferences(next);
    localStorage.setItem("qimiao-clipboard-window", JSON.stringify(next));
    void configureClipboardWindow(next, resize).catch((error) => showToast(String(error)));
  }
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => { media.removeEventListener("change", changed); clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => {
    const dark = settings.theme === "dark" || (settings.theme === "system" && systemDark);
    Object.assign(document.documentElement.dataset, { theme: settings.theme, appearance: dark ? "dark" : "light", material: settings.material, motion: settings.motionEffects ? "full" : "reduced", window: "clipboard" });
    document.documentElement.style.setProperty("--ui-font", fontStackFor(settings.fontFamily));
    document.documentElement.lang = en ? "en" : "zh-CN";
    void setWindowMaterial(settings.material, dark, settings.theme === "system").catch(console.warn);
  }, [settings.theme, settings.material, settings.motionEffects, settings.fontFamily, systemDark, en]);
  useEffect(() => {
    void configureClipboardWindow(latestPrefs.current, true).catch(console.warn);
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    const disposers: (() => void)[] = [];
    void (async () => {
      const shown = await listen("clipboard-shown", () => { setQuery(""); requestAnimationFrame(() => input.current?.focus()); });
      if (disposed) shown(); else disposers.push(shown);
      const resized = await getCurrentWindow().onResized(async ({ payload }) => {
        const scale = await getCurrentWindow().scaleFactor();
        if (disposed) return;
        const next = normalizeClipboardWindow({ ...latestPrefs.current, width: payload.width / scale, height: payload.height / scale, singleColumn: payload.width / scale < 560 || latestPrefs.current.singleColumn });
        latestPrefs.current = next;
        setPreferences(next);
        localStorage.setItem("qimiao-clipboard-window", JSON.stringify(next));
      });
      if (disposed) resized(); else disposers.push(resized);
    })().catch(console.warn);
    return () => { disposed = true; disposers.forEach((fn) => fn()); };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !composing.current && !document.querySelector("[data-local-dialog], .clip-context-menu")) void hideLauncher();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return <main className={`stage clipboard-stage ${preferences.singleColumn ? "clipboard-single-column" : ""}`}>
    <section className="launcher-shell clipboard-window-shell">
      <header className="clipboard-window-header" onMouseDown={(event) => {
        if (event.button === 0 && !(event.target as Element).closest("button,input,select")) void startWindowDrag();
      }}>
        <strong>{en ? "Clipboard" : "剪贴板"}</strong>
        <span>Qimiao</span>
        <button className="clip-icon-button" title={en ? "Hide window" : "隐藏窗口"} aria-label={en ? "Hide window" : "隐藏窗口"} onClick={() => void hideLauncher()}><X /></button>
      </header>
      <div className="clipboard-window-search">
        <Search size={17} />
        <input ref={input} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; compositionEnded.current = Date.now(); }} placeholder={en ? "Search clipboard history" : "搜索剪贴板历史"} aria-label={en ? "Search clipboard history" : "搜索剪贴板历史"} />
        {query && <button className="clip-icon-button" aria-label={en ? "Clear search" : "清除搜索"} onClick={() => { setQuery(""); input.current?.focus(); }}><X /></button>}
      </div>
      <div className="clipboard-window-controls">
        <label>{en ? "Position" : "窗口位置"}<select value={preferences.position} onChange={(event) => updatePreferences({ position: event.target.value as ClipboardWindowPreferences["position"] })}>
          <option value="center">{en ? "Always centered" : "始终居中"}</option>
          <option value="mouse">{en ? "Near mouse" : "跟随鼠标"}</option>
          <option value="input">{en ? "Near input window" : "跟随输入窗口"}</option>
        </select></label>
        <button className="clip-icon-button" aria-pressed={preferences.singleColumn} aria-label={en ? "Single column" : "单列模式"} title={en ? "Toggle single column" : "切换单列模式"} onClick={() => updatePreferences({ singleColumn: !preferences.singleColumn, width: preferences.singleColumn ? 820 : 390 }, true)}>{preferences.singleColumn ? <Columns2 /> : <PanelLeft />}</button>
      </div>
      {preferences.position === "input" && <p className="clipboard-position-hint">{en ? "Opens beside the focused field or window. Falls back to the mouse if unavailable." : "唤起时靠近输入框或输入窗口；无法定位时跟随鼠标。"}</p>}
      <ClipboardPane {...client} query={query} showToast={showToast} imeActive={() => composing.current || Date.now() - compositionEnded.current < 140} />
      {toast && <div className="clipboard-window-toast" role="status">{toast}</div>}
    </section>
    <WindowResizeHandles />
  </main>;
}
