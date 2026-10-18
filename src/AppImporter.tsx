import { useMemo, useState } from "react";
import {
  X,
  Plus,
  FolderOpen,
  Monitor,
  LayoutGrid,
  Search,
  Check,
  FilePlus2,
} from "lucide-react";
import { chooseApps, manualAppCandidates } from "./tauri";
import type { AppItem } from "./types";
import AppGlyph from "./AppGlyph";

export default function AppImporter({
  apps,
  en,
  onAdd,
  onClose,
}: {
  apps: AppItem[];
  en: boolean;
  onAdd: (items: AppItem[]) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState(""),
    [candidates, setCandidates] = useState<AppItem[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const existing = useMemo(
    () => new Set(apps.map((a) => a.path.toLocaleLowerCase())),
    [apps],
  );
  const filtered = useMemo(
    () =>
      candidates.filter((a) =>
        `${a.name} ${a.path}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ),
    [query, candidates],
  );
  const visible = filtered.slice(0, 200);
  const fresh = filtered.filter(
    (a) => !existing.has(a.path.toLocaleLowerCase()),
  );
  const importFrom = async (next: "desktop" | "start-menu" | "folder") => {
    setBusy(true);
    setSource(next);
    setError("");
    setQuery("");
    setSelected(new Set());
    try {
      setCandidates(await manualAppCandidates(next));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  async function choose() {
    setBusy(true);
    setError("");
    try {
      const items = await chooseApps();
      if (items.length) onAdd(items);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-shade importer-overlay"
      data-local-dialog
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <section
        className="app-importer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="importer-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
            ),
          );
          const first = controls[0],
            last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <header>
          <div>
            <h2 id="importer-title">{en ? "Add applications" : "添加应用"}</h2>
            <p>
              {en
                ? "Choose a source, then check the apps you want. Nothing is added automatically."
                : "选择来源，再勾选要添加的软件。不会自动抓取或加入列表。"}
            </p>
          </div>
          <button
            className="clip-close"
            onClick={onClose}
            aria-label={en ? "Close" : "关闭"}
          >
            <X />
          </button>
        </header>
        <div className="importer-sources">
          <button
            autoFocus
            disabled={busy}
            className={source === "desktop" ? "active" : ""}
            onClick={() => void importFrom("desktop")}
          >
            <Monitor />
            <strong>{en ? "Desktop" : "桌面快捷方式"}</strong>
            <small>{en ? "User + public desktop" : "当前用户与公共桌面"}</small>
          </button>
          <button
            disabled={busy}
            className={source === "start-menu" ? "active" : ""}
            onClick={() => void importFrom("start-menu")}
          >
            <LayoutGrid />
            <strong>{en ? "Start menu" : "开始菜单"}</strong>
            <small>
              {en ? "Choose installed shortcuts" : "从应用快捷方式中选择"}
            </small>
          </button>
          <button
            disabled={busy}
            className={source === "folder" ? "active" : ""}
            onClick={() => void importFrom("folder")}
          >
            <FolderOpen />
            <strong>{en ? "Folder" : "指定文件夹"}</strong>
            <small>{en ? "Choose a location" : "自己选择软件目录"}</small>
          </button>
        </div>
        <div className="importer-file-row">
          <FilePlus2 size={17} />
          <span>
            {en ? "Already know where the app is?" : "知道程序文件在哪里？"}
          </span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void choose()}
          >
            {en ? "Select .exe / .lnk files" : "直接多选 .exe / .lnk"}
          </button>
        </div>
        {error && (
          <p className="importer-error" role="alert">
            {error}
          </p>
        )}
        {source && (
          <>
            <div className="importer-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={en ? "Filter by app name…" : "按软件名称筛选…"}
                aria-label={en ? "Filter applications" : "筛选应用"}
              />
              <span>{filtered.length}</span>
            </div>
            <div className="importer-select">
              <span>
                {en ? `${selected.size} selected` : `已选 ${selected.size} 个`}
              </span>
              <button
                disabled={busy || !fresh.length}
                onClick={() =>
                  setSelected(new Set([...selected, ...fresh.map((a) => a.id)]))
                }
              >
                {en ? "Select filtered" : "全选筛选结果"}
              </button>
              <button onClick={() => setSelected(new Set())}>
                {en ? "Select none" : "取消全选"}
              </button>
            </div>
            <div className="importer-list">
              {busy ? (
                <p>{en ? "Reading shortcuts…" : "正在读取快捷方式…"}</p>
              ) : visible.length ? (
                visible.map((a) => {
                  const added = existing.has(a.path.toLocaleLowerCase());
                  return (
                    <label key={a.id} className={added ? "already-added" : ""}>
                      <input
                        type="checkbox"
                        checked={added || selected.has(a.id)}
                        disabled={added}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(a.id)) next.delete(a.id);
                            else next.add(a.id);
                            return next;
                          })
                        }
                      />
                      <AppGlyph app={a} />
                      <span>
                        <strong>{a.name}</strong>
                        <small title={a.path}>{a.path}</small>
                      </span>
                      {added && <em>{en ? "Added" : "已添加"}</em>}
                    </label>
                  );
                })
              ) : (
                <p>
                  {en
                    ? "No matching shortcuts found. You can select program files directly."
                    : "没有找到匹配的软件，可改用“直接多选程序文件”。"}
                </p>
              )}
              {filtered.length > 200 && (
                <p>
                  {en
                    ? "Showing 200. Filter by name to narrow the list."
                    : "显示前 200 项，可输入名称缩小范围。"}
                </p>
              )}
            </div>
          </>
        )}
        <footer>
          <small>
            {en
              ? "Only apps and shortcuts, no documents or folders."
              : "仅导入应用和快捷方式，不导入文档或文件夹。"}
          </small>
          <button
            className="primary"
            disabled={busy || !selected.size}
            onClick={() => onAdd(candidates.filter((a) => selected.has(a.id)))}
          >
            <Check size={16} />
            {en ? `Add ${selected.size}` : `添加 ${selected.size} 个`}
          </button>
        </footer>
      </section>
    </div>
  );
}
