import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, RefreshCw, Search, Type, X } from "lucide-react";
import { fontStackFor } from "./appearance";
import { listLocalFonts } from "./tauri";

export default function FontPicker({ value, onChange, en }: { value: string; onChange: (family: string) => void; en: boolean }) {
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(60);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    listLocalFonts().then((families) => { if (active) setFonts(families); }).catch(() => {
      if (active) setError(en ? "Couldn't read local fonts. Try refreshing the catalog." : "无法读取本机字体，请刷新字体列表重试。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; trigger.current?.focus(); };
  }, [open, en]);
  const filtered = useMemo(() => fonts.filter((font) => font.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [fonts, query]);
  async function refresh() {
    setLoading(true);
    setError("");
    try { setFonts(await listLocalFonts(true)); }
    catch { setError(en ? "Couldn't read local fonts. Please try again." : "无法读取本机字体，请重试。"); }
    finally { setLoading(false); }
  }
  const systemLabel = en ? "System default" : "系统默认";
  return <>
    <button ref={trigger} className="font-picker-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setQuery(""); setLimit(60); setOpen(true); }}>
      <Type /><span style={{ fontFamily: fontStackFor(value) }}>{value || systemLabel}</span><ChevronDown />
    </button>
    {open && createPortal(<div className="font-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} onKeyDownCapture={(event) => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      if (event.key === "Tab") {
        event.stopPropagation();
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? []);
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus(); }
        else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus(); }
      }
    }}>
      <div ref={dialog} className="font-dialog" role="dialog" aria-modal="true" aria-labelledby="font-dialog-title">
        <div className="font-dialog-heading"><div><h2 id="font-dialog-title">{en ? "Your fonts. Your launcher." : "选择你的界面字体"}</h2><p>{en ? "Installed on this device. Nothing to download." : "使用本机已安装字体，无需下载。"}</p></div><button aria-label={en ? "Close fonts" : "关闭字体选择"} onClick={() => setOpen(false)}><X /></button></div>
        <label className="font-search"><Search /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setLimit(60); }} aria-label={en ? "Search local fonts" : "搜索本地字体"} placeholder={en ? "Search font families…" : "搜索字体名称…"} /><button aria-label={en ? "Refresh font catalog" : "刷新字体列表"} onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} /></button></label>
        <div className="font-live-preview" style={{ fontFamily: fontStackFor(value) }}><span>{value || systemLabel}</span><strong>{en ? "Everything, a little closer." : "常用的，触手可及。"}</strong><p>启喵 qimiao · Aa Bb Cc 0123456789</p></div>
        <div className="font-catalog" role="group" aria-label={en ? "Local font families" : "本地字体列表"} aria-busy={loading}>
          <button className={!value ? "selected" : ""} aria-pressed={!value} onClick={() => onChange("")}><Type /><span>{systemLabel}</span>{!value && <Check />}</button>
          {loading ? <div className="font-catalog-message">{en ? "Reading font catalog…" : "正在读取字体列表…"}</div> : error ? <div className="font-catalog-message" role="alert">{error}</div> : <>
            {filtered.slice(0, limit).map((font) => <button key={font} className={value === font ? "selected" : ""} aria-pressed={value === font} style={{ fontFamily: fontStackFor(font) }} onClick={() => onChange(font)}><span className="font-specimen">Aa</span><span>{font}</span>{value === font && <Check />}</button>)}
            {!filtered.length && <div className="font-catalog-message">{en ? "No matching font families" : "没有匹配的字体"}</div>}
            {filtered.length > limit && <button className="font-more" onClick={() => setLimit((count) => count + 60)}>{en ? "Show more fonts" : "加载更多字体"}</button>}
          </>}
        </div>
        <footer><span>{en ? `${fonts.length} local families · changes saved automatically` : `${fonts.length} 个本地字体家族 · 选择后自动保存`}</span><button className="primary" onClick={() => setOpen(false)}>{en ? "Done" : "完成"}<Check /></button></footer>
      </div>
    </div>, document.body)}
  </>;
}
