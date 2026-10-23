import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Clipboard,
  Copy,
  Pin,
  Star,
  Trash2,
  Plus,
  Pause,
  Play,
  Settings2,
  Image,
  File,
  Code2,
  Link,
  Hash,
  Mail,
  Phone,
  Type,
  ListOrdered,
  Pencil,
  Download,
  Eye,
  X,
  ShieldCheck,
  ArrowRight,
  MoreHorizontal,
  ExternalLink,
  Archive,
  AppWindow,
  Folder,
} from "lucide-react";
import {
  clipKindLabels,
  cleanTrackingParams,
  mergeClips,
  splitRelayText,
  textClip,
  detectClipKind,
  type Clip,
  type ClipKind,
} from "./clipboard-core";
import { copyClip, exportClip, syncDavImage, openExternalUrl, openPath, setClipboardText, openMacosPermission, clipboardPasteStatus, clipboardFileInfo } from "./tauri";
import { clipboardCategory, clipRelativeTime, clipLink, clipByteSize, formatBytes, type ClipboardFileInfo } from "./clipboard-view";
import type { Settings } from "./types";
import "./clipboard.css";

const icons = {
  text: Type,
  link: Link,
  code: Code2,
  color: Hash,
  email: Mail,
  phone: Phone,
  image: Image,
  file: File,
};
export default function ClipboardPane({
  query,
  settings,
  update,
  clips,
  setClips,
  paused,
  setPaused,
  error,
  notice = "",
  ready,
  showToast,
  imeActive,
}: {
  query: string;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  clips: Clip[];
  setClips: Dispatch<SetStateAction<Clip[]>>;
  paused: boolean;
  setPaused: (p: boolean) => void;
  error: string;
  notice?: string;
  ready: boolean;
  showToast: (s: string) => void;
  imeActive: () => boolean;
}) {
  const en = settings.language === "en",
    options = settings.clipboardOptions;
  const [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState("");
  const [preferences, setPreferences] = useState(false),
    [revealed, setRevealed] = useState("");
  const [editor, setEditor] = useState<{
    id?: string;
    text: string;
    title: string;
    group: string;
  } | null>(null);
  const [clear, setClear] = useState(false),
    [working, setWorking] = useState(false);
  const [pastePermissionHelp, setPastePermissionHelp] = useState(false);
  const [pasteStatus, setPasteStatus] = useState<{ trusted: boolean; executable: string } | null>(null);
  const [pasteStatusError, setPasteStatusError] = useState("");
  async function checkPastePermission() {
    setPasteStatus(null);
    setPasteStatusError("");
    try { setPasteStatus(await clipboardPasteStatus()); }
    catch (error) { setPasteStatusError(String(error)); }
  }
  useEffect(() => { if (pastePermissionHelp) void checkPastePermission(); }, [pastePermissionHelp]);
  const [permissionRetry, setPermissionRetry] = useState<{ clip: Clip; plain: boolean; enter: boolean } | null>(null);
  const [queue, setQueue] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("qimiao-relay-queue") ?? "[]",
      ).filter((s: unknown) => typeof s === "string");
    } catch {
      return [];
    }
  });
  const [delimiter, setDelimiter] = useState("\n");
  const [context, setContext] = useState<{ id: string; x: number; y: number } | null>(null);
  const [groupEditor, setGroupEditor] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = useMemo(() => clips.filter((c) => !c.deletedAt), [clips]);
  const groups = [
    ...new Set(
      active.map((c) => c.group).filter((s): s is string => Boolean(s)),
    ),
  ].sort();
  const visible = useMemo(
    () =>
      active
        .filter(
          (c) =>
            filter === "all" ||
            (filter === "pinned" && c.pinned) ||
            (filter === "favorite" && c.favorite) ||
            filter === c.kind ||
            filter === clipboardCategory(c) ||
            filter === `group:${c.group}`,
        )
        .filter(
          (c) =>
            !query ||
            `${c.title ?? ""} ${c.text} ${c.group ?? ""} ${c.sourceApp ?? ""} ${c.files?.join(" ") ?? ""}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
        )
        .sort(
          (a, b) =>
            Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
            (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt),
        ),
    [active, filter, query],
  );
  const item = visible.find((c) => c.id === selected) ?? visible[0];
  const [fileInfo, setFileInfo] = useState(() => new Map<string, ClipboardFileInfo>());
  const fileRequests = useRef(new Set<string>());
  useEffect(() => {
    const paths = [...new Set([...(item?.files ?? []), ...visible.slice(0, 80).flatMap((clip) => clip.files ?? [])])]
      .filter((path) => !fileRequests.current.has(path)).slice(0, 128);
    if (!paths.length) return;
    paths.forEach((path) => fileRequests.current.add(path));
    void clipboardFileInfo(paths).then((entries) => {
      setFileInfo((current) => new Map([...current, ...entries.map((entry) => [entry.path, entry] as const)]));
    }).catch(() => {
      paths.forEach((path) => fileRequests.current.delete(path));
    });
  }, [item, visible, fileInfo]);
  const contextItem = active.find((c) => c.id === context?.id);
  const link = item?.kind === "link" ? clipLink(item.text) : null;
  useEffect(() => { setContext(null); }, [filter, query]);
  useEffect(() => {
    if (!context) return;
    const menu = menuRef.current;
    const bounds = menu?.getBoundingClientRect();
    if (menu && bounds) {
      menu.style.left = `${Math.max(8, Math.min(context.x, window.innerWidth - bounds.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(context.y, window.innerHeight - bounds.height - 8))}px`;
      menu.querySelector<HTMLButtonElement>("button")?.focus();
    }
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setContext(null);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); setContext(null);
        selectedRef.current?.focus();
      } else if (["ArrowDown", "ArrowUp", "Tab"].includes(event.key) && !(event.target as Element).closest("input")) {
        event.preventDefault(); event.stopImmediatePropagation();
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === "ArrowUp" || event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", keyboard, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", keyboard, true); };
  }, [context, groupEditor]);
  const queueItems = queue
    .map((id) => active.find((c) => c.id === id))
    .filter((c): c is Clip => Boolean(c));
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [item?.id]);
  useEffect(() => {
    localStorage.setItem("qimiao-relay-queue", JSON.stringify(queue));
  }, [queue]);
  useEffect(() => {
    setRevealed("");
  }, [item?.id]);
  function patch(id: string, p: Partial<Clip>) {
    setClips((current) =>
      current.map((c) =>
        c.id === id ? { ...c, ...p, updatedAt: Date.now() } : c,
      ),
    );
  }
  function remove(id: string) {
    patch(id, {
      deletedAt: Date.now(),
      text: "",
      html: undefined,
      files: [],
      thumbnail: undefined,
      title: undefined,
      group: undefined,
    });
    setQueue((q) => q.filter((v) => v !== id));
  }
  async function perform(
    clip: Clip,
    paste = false,
    plain = false,
    enter = false,
  ) {
    if (working) return false;
    setWorking(true);
    try {
      if (clip.imageKey && settings.webdav.clipboardEnabled && !plain)
        await syncDavImage(settings.webdav, clip.imageKey, false);
      await copyClip(clip, plain, paste, enter);
      patch(clip.id, { lastUsedAt: Date.now() });
      showToast(
        en ? (paste ? "Pasted" : "Copied") : paste ? "已粘贴" : "已复制",
      );
      return true;
    } catch (error) {
      if (String(error).includes("QIMIAO_MACOS_PASTE_PERMISSION")) {
        setPermissionRetry({ clip, plain, enter });
        setPastePermissionHelp(true);
      }
      else showToast(String(error));
      return false;
    } finally {
      setWorking(false);
    }
  }
  async function next(paste: boolean) {
    const clip = queueItems[0];
    if (clip && (await perform(clip, paste)))
      setQueue((q) => q.slice(q.indexOf(clip.id) + 1));
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || imeActive()) return;
      if (
        context || editor ||
        clear ||
        preferences ||
        document.querySelector("[data-local-dialog]")
      )
        return;
      const target = event.target as HTMLElement;
      if (
        target.closest("textarea, select") ||
        target.closest(".clipboard-workspace input")
      )
        return;
      const button = target.closest("button");
      if (button && button.getAttribute("role") !== "option") return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = visible.findIndex((c) => c.id === item?.id);
        setSelected(
          visible[
            Math.max(
              0,
              Math.min(
                visible.length - 1,
                index + (event.key === "ArrowDown" ? 1 : -1),
              ),
            )
          ]?.id ?? "",
        );
      }
      if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const c = visible[Number(event.key) - 1];
        if (c) void perform(c, true);
      } else if (event.key === "Enter" && item) {
        event.preventDefault();
        void perform(item, true, event.altKey || event.metaKey || event.ctrlKey, event.shiftKey);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && item) {
        event.preventDefault();
        setGroupEditor(false); setContext({ id: item.id, x: window.innerWidth - 270, y: window.innerHeight - 420 });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function addQueue(c: Clip) {
    setQueue((q) => (q.includes(c.id) ? q : [...q, c.id]));
  }
  function split(clip = item) {
    if (!clip) return;
    const parts = splitRelayText(clip.text, delimiter);
    if (!parts.length) {
      showToast(en ? "No matching separator found" : "未找到可拆分的分隔符");
      return;
    }
    const entries = parts.map((t) => textClip(t));
    setClips((current) => mergeClips(current, entries, options));
    setQueue((q) => [...q, ...entries.map((c) => c.id)]);
  }
  const controlsDisabled = working || !item;
  const previewHidden = item?.sensitive && revealed !== item.id;
  const option = (key: "skipSensitive", zh: string, eng: string) => (
    <label className="clip-check">
      <input
        type="checkbox"
        checked={options[key]}
        onChange={(e) =>
          update({ clipboardOptions: { ...options, [key]: e.target.checked } })
        }
      />
      {en ? eng : zh}
    </label>
  );
  return (
    <section className="clipboard-workspace">
      <div className="clip-toolbar">
        <div>
          <Clipboard size={18} />
          <strong>{en ? "Clipboard" : "剪贴板"}</strong>
          <span className="clip-count">{active.length}</span>
        </div>
        <div>
          {navigator.userAgent.includes("Mac") && <button className="clip-icon-button" title={en ? "macOS paste permissions" : "macOS 粘贴权限指引"} aria-label={en ? "macOS paste permissions" : "macOS 粘贴权限指引"} onClick={() => { setPermissionRetry(null); setPastePermissionHelp(true); }}><ShieldCheck /></button>}
          <button
            className="clip-icon-button"
            disabled={!ready}
            title={en ? "New text" : "新建文本"}
            aria-label={en ? "New text" : "新建文本"}
            onClick={() => setEditor({ text: "", title: "", group: "" })}
          >
            <Plus />
          </button>
          <button
            className="clip-icon-button"
            title={en ? "Privacy and retention" : "隐私与保留规则"}
            aria-label={en ? "Privacy and retention" : "隐私与保留规则"}
            onClick={() => setPreferences(!preferences)}
          >
            <Settings2 />
          </button>
          <button
            className="clip-icon-button"
            title={
              en
                ? paused
                  ? "Resume capture"
                  : "Pause capture"
                : paused
                  ? "恢复记录"
                  : "暂停记录"
            }
            aria-label={en ? "Pause or resume capture" : "暂停或恢复记录"}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play /> : <Pause />}
          </button>
          <button
            className="clip-icon-button"
            title={en ? "Clear history" : "清空历史"}
            aria-label={en ? "Clear history" : "清空历史"}
            disabled={!active.length}
            onClick={() => setClear(true)}
          >
            <Trash2 />
          </button>
        </div>
      </div>
      {(!settings.clipboardHistoryEnabled || paused) && (
        <div className="clip-notice">
          {en
            ? "Capture is paused. Existing entries remain available."
            : "记录已暂停，仍可使用已有记录。"}
          {!settings.clipboardHistoryEnabled && (
            <button onClick={() => update({ clipboardHistoryEnabled: true })}>
              {en ? "Enable" : "开启记录"}
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="clip-notice" role="alert">
          {error}
        </div>
      )}
      {notice && !error && settings.clipboardHistoryEnabled && !paused && (
        <div className="clip-notice" role="status">{notice}</div>
      )}
      {preferences ? (
        <div className="clip-preferences">
          <h3>
            <ShieldCheck size={18} />
            {en ? "Privacy & storage" : "隐私与存储"}
          </h3>
          <p className="clip-muted">
            {en
              ? "Original images stay on disk; only thumbnails are loaded. Records are local unless you enable WebDAV in Settings."
              : "原图保存在磁盘，只加载缩略图。未在设置中开启 WebDAV 时，所有记录只保留在本机。"}
          </p>
          <div className="clip-checks">
            {option(
              "skipSensitive",
              "跳过疑似密码和密钥（无法保证识别所有秘密）",
              "Skip suspected passwords and keys (not a guarantee)",
            )}
          </div>
          <div className="dav-form">
            <label>
              {en ? "Keep for" : "保留天数"}
              <select
                value={options.retentionDays}
                onChange={(e) =>
                  update({
                    clipboardOptions: {
                      ...options,
                      retentionDays: Number(e.target.value),
                    },
                  })
                }
              >
                {[7, 30, 90, 0].map((v) => (
                  <option key={v} value={v}>
                    {v || (en ? "Forever" : "永久")}
                    {v ? (en ? " days" : " 天") : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {en ? "Maximum entries" : "最多记录"}
              <select
                value={options.maxItems}
                onChange={(e) =>
                  update({
                    clipboardOptions: {
                      ...options,
                      maxItems: Number(e.target.value),
                    },
                  })
                }
              >
                {[100, 500, 1000, 3000].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="clip-label">
            {en
              ? "Excluded apps (one name or bundle ID per line)"
              : "忽略的应用（每行一个名称或 Bundle ID）"}
            <textarea
              value={options.ignoredApps.join("\n")}
              onChange={(e) =>
                update({
                  clipboardOptions: {
                    ...options,
                    ignoredApps: e.target.value.split("\n").slice(0, 100),
                  },
                })
              }
            />
          </label>
          <h3>{en ? "Automatic text rules" : "自动文本规则"}</h3>
          <div className="clip-checks">
            {(
              [
                [
                  "cleanTracking",
                  "去除链接跟踪参数",
                  "Remove URL tracking parameters",
                ],
                ["lowercaseEmail", "邮箱转小写", "Lowercase email addresses"],
                ["removeBlankLines", "移除空白行", "Remove blank lines"],
              ] as const
            ).map(([key, zh, eng]) => (
              <label key={key} className="clip-check">
                <input
                  type="checkbox"
                  checked={options.rules[key]}
                  onChange={(e) =>
                    update({
                      clipboardOptions: {
                        ...options,
                        rules: { ...options.rules, [key]: e.target.checked },
                      },
                    })
                  }
                />
                {en ? eng : zh}
              </label>
            ))}
          </div>
          <p className="clip-muted">
            {en
              ? "Pinned entries are excluded from automatic cleanup. Password-manager filtering is best effort; Linux does not report the source app."
              : "置顶记录不参与自动清理。密码管理器过滤为尽力识别；Linux 暂不能识别来源应用。"}
          </p>
          <button className="secondary" onClick={() => setPreferences(false)}>
            {en ? "Done" : "完成"}
          </button>
        </div>
      ) : (
        <>
          <nav
            className="clip-sidebar"
            aria-label={en ? "Clipboard filters" : "剪贴板筛选"}
          >
            {(
              [
                ["pinned", Pin, en ? "Pinned" : "置顶"],
                ["all", Clipboard, en ? "All" : "全部"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
            {(["text", "code", "link", "image"] as ClipKind[]).map((kind) => {
              const Icon = icons[kind];
              return (
                <button
                  key={kind}
                  className={filter === kind ? "active" : ""}
                  onClick={() => setFilter(kind)}
                >
                  <Icon size={16} />
                  <span>{clipKindLabels[kind][en ? 1 : 0]}</span>
                </button>
              );
            })}
            {([["document", File, en ? "Documents" : "文档"], ["archive", Archive, en ? "Archives" : "压缩包"], ["application", AppWindow, en ? "Apps" : "应用"], ["other", Folder, en ? "Other files" : "其他文件"]] as const).map(([id, Icon, label]) => (
              <button key={id} aria-pressed={filter === id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}><Icon size={16}/><span>{label}</span></button>
            ))}
            <select aria-label={en ? "More filters and groups" : "更多分类与分组"} value={["favorite", "color", "email", "phone", "file"].includes(filter) || filter.startsWith("group:") ? filter : ""} onChange={(event) => setFilter(event.target.value || "all")}>
              <option value="">{en ? "More / groups" : "更多 / 分组"}</option>
              <option value="favorite">{en ? "Favorites" : "收藏"}</option>
              {(["color", "email", "phone", "file"] as ClipKind[]).map((kind) => <option key={kind} value={kind}>{clipKindLabels[kind][en ? 1 : 0]}</option>)}
              {groups.map((group) => <option key={group} value={`group:${group}`}>{group}</option>)}
            </select>
          </nav>
          <div className="clip-body">
          <div
            className="clip-list"
            role="listbox"
            aria-label={en ? "Clipboard entries" : "剪贴板记录"}
          >
            {!ready ? (
              <div className="clip-empty">
                {en ? "Loading local history…" : "正在读取本机记录…"}
              </div>
            ) : visible.length ? (
              visible.slice(0, 400).map((c, index) => {
                const category = clipboardCategory(c);
                const Icon = c.kind === "file" ? category === "archive" ? Archive : category === "application" ? AppWindow : c.files?.length === 1 && fileInfo.get(c.files[0])?.isDirectory ? Folder : File : icons[c.kind];
                const byteSize = formatBytes(clipByteSize(c, fileInfo));
                return (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={item?.id === c.id}
                    ref={item?.id === c.id ? selectedRef : undefined}
                    className={`clip-entry ${item?.id === c.id ? "selected" : ""}`}
                    onClick={() => setSelected(c.id)}
                    onDoubleClick={() => void perform(c, true)}
                    onContextMenu={(event) => {
                      event.preventDefault(); setSelected(c.id); setGroupEditor(false);
                      setContext({ id: c.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <span className="clip-entry-symbol">
                      {c.kind === "image" && c.thumbnail && !c.sensitive ? (
                        <img src={c.thumbnail} alt="" />
                      ) : (
                        <Icon size={20} />
                      )}
                    </span>
                    <span className="clip-entry-copy">
                      <strong>
                        {c.sensitive
                            ? en
                              ? "Sensitive content"
                              : "敏感内容"
                            : c.title || (c.kind === "image"
                              ? `${en ? "Image" : "图片"} ${c.width ?? ""} × ${c.height ?? ""}`
                              : c.kind === "file"
                                ? c.files
                                    ?.map((p) => p.split(/[\\/]/).pop())
                                    .join(", ")
                                : c.text.slice(0, 120))}
                      </strong>
                      <small>
                        <span className="clip-entry-source">
                        {c.sourceApp || clipKindLabels[c.kind][en ? 1 : 0]} ·{" "}
                        {clipRelativeTime(c.createdAt, en)}{" "}
                        {c.group ? `· ${c.group}` : ""}
                        </span>
                        {(c.kind === "image" || c.kind === "file") && byteSize ? <span className="clip-entry-size">{byteSize}</span> : null}
                      </small>
                    </span>
                    <span className="clip-entry-flags">
                      {c.pinned && <Pin size={12} />}{" "}
                      {c.favorite && <Star size={12} />}{" "}
                      {index < 9 && <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}{index + 1}</kbd>}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="clip-empty">
                <Clipboard size={32} />
                <strong>{en ? "Nothing here yet" : "这里还没有记录"}</strong>
                <p>
                  {query
                    ? en
                      ? "Try another search"
                      : "换个关键词试试"
                    : en
                      ? "Copy text, an image or a file in another app. It will appear here."
                      : "在其他应用中复制文本、图片或文件，即可在这里查看。"}
                </p>
              </div>
            )}
            {visible.length > 400 && (
              <p className="clip-muted">
                {en
                  ? "Showing the first 400 results. Search to narrow the list."
                  : "显示前 400 条，请搜索缩小范围。"}
              </p>
            )}
          </div>
          <article className="clip-detail">
            {item ? (
              <>
                <header>
                  <span>{link && !previewHidden ? link.hostname : clipKindLabels[item.kind][en ? 1 : 0]}</span>
                  <div>
                    <button
                      className={`clip-icon-button ${item.pinned ? "active" : ""}`}
                      title={en ? "Pin" : "置顶"}
                      aria-label={en ? "Pin" : "置顶"}
                      onClick={() => patch(item.id, { pinned: !item.pinned })}
                    >
                      <Pin />
                    </button>
                    <button
                      className={`clip-icon-button ${item.favorite ? "active" : ""}`}
                      title={en ? "Favorite" : "收藏"}
                      aria-label={en ? "Favorite" : "收藏"}
                      onClick={() =>
                        patch(item.id, { favorite: !item.favorite })
                      }
                    >
                      <Star />
                    </button>
                    <button
                      className="clip-icon-button"
                      aria-label={en ? "Edit" : "编辑"}
                      title={en ? "Edit" : "编辑"}
                      onClick={() =>
                        setEditor({
                          id: item.id,
                          text: item.text,
                          title: item.title ?? "",
                          group: item.group ?? "",
                        })
                      }
                    >
                      <Pencil />
                    </button>
                    <button
                      className="clip-icon-button"
                      aria-label={en ? "Delete" : "删除"}
                      title={en ? "Delete" : "删除"}
                      onClick={() => remove(item.id)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </header>
                <div className="clip-preview">
                  {previewHidden ? (
                    <button
                      className="secondary"
                      onClick={() => setRevealed(item.id)}
                    >
                      <Eye size={16} />
                      {en ? "Reveal sensitive content" : "显示敏感内容"}
                    </button>
                  ) : item.kind === "image" ? (
                    <img
                      className="clip-preview-image"
                      src={item.thumbnail}
                      alt={en ? "Clipboard image preview" : "剪贴板图片预览"}
                    />
                  ) : item.kind === "color" ? (
                    <>
                      <div
                        className="clip-color"
                        style={{
                          background: CSS.supports("color", item.text.trim())
                            ? item.text.trim()
                            : "transparent",
                        }}
                      />
                      <pre>{item.text}</pre>
                    </>
                  ) : item.kind === "file" ? (
                    <div className="clip-file-preview">{item.files?.map((path) => {
                      const info = fileInfo.get(path);
                      const FileIcon = info?.isDirectory ? Folder : clipboardCategory({ ...item, files: [path] }) === "archive" ? Archive : File;
                      return <button className="secondary" key={path} title={path} onClick={() => void openPath(path).catch((error) => showToast(String(error)))}><FileIcon size={20}/><span><strong>{path.split(/[\\/]/).pop()}</strong><small>{info?.isDirectory ? (en ? "Folder" : "文件夹") : formatBytes(info?.byteSize) || (en ? "Size unavailable" : "大小暂不可用")}</small></span><ExternalLink size={14}/></button>;
                    })}</div>
                  ) : link ? (
                    <div className="clip-link-preview">
                      <span className="clip-link-protocol"><Link size={20}/>{link.hostname}<small>{link.protocol.slice(0, -1).toUpperCase()}</small></span>
                      <h3>{item.title || link.hostname}</h3>
                      <p>{item.text}</p>
                      <button className="secondary" onClick={() => void openExternalUrl(link.href).catch((error) => showToast(String(error)))}><ExternalLink size={15}/>{en ? "Open in browser" : "在浏览器中打开"}</button>
                    </div>
                  ) : (
                    <pre className={item.kind === "code" ? "clip-code" : ""}>
                      {item.text}
                    </pre>
                  )}
                </div>
                <dl className="clip-metadata">
                  <dt>{en ? "Source" : "来源"}</dt>
                  <dd>
                    {item.sourceApp ||
                      (en ? "Manual / synced" : "手动添加 / 同步")}
                  </dd>
                  <dt>{en ? "Created" : "时间"}</dt>
                  <dd>{new Date(item.createdAt).toLocaleString()}</dd>
                  <dt>{en ? "Size" : "大小"}</dt>
                  <dd>
                    {formatBytes(clipByteSize(item, fileInfo)) || (en ? "Unavailable" : "暂不可用")}
                    {item.kind !== "file" && item.kind !== "image" ? ` · ${item.text.length} ${en ? "characters" : "字符"}` : ""}
                  </dd>
                  {item.kind === "image" && item.width && item.height ? <><dt>{en ? "Dimensions" : "尺寸"}</dt><dd>{item.width} × {item.height} px</dd></> : null}
                </dl>
                <div className="clip-actions clip-legacy-actions">
                  <button
                    className="primary"
                    disabled={controlsDisabled}
                    onClick={() => void perform(item, true)}
                  >
                    <ArrowRight size={16} />
                    {en ? "Paste" : "粘贴"}
                  </button>
                  <button
                    className="secondary"
                    disabled={controlsDisabled}
                    onClick={() => void perform(item)}
                  >
                    <Copy size={16} />
                    {en ? "Copy" : "复制"}
                  </button>
                  <button
                    className="secondary"
                    disabled={controlsDisabled}
                    onClick={() => void perform(item, true, true)}
                  >
                    {en ? "Paste plain" : "纯文本粘贴"}
                  </button>
                  <button
                    className="secondary"
                    disabled={controlsDisabled}
                    title={
                      en
                        ? "Paste then press Enter in the target app"
                        : "粘贴后会在目标应用中按回车，请确认内容"
                    }
                    onClick={() => void perform(item, true, false, true)}
                  >
                    {en ? "Paste + Enter" : "粘贴并回车"}
                  </button>
                </div>
                <details className="clip-extra-actions"><summary>{en ? "More actions & text tools" : "更多操作与文本处理"}</summary>
                <div className="clip-actions">
                  <button className="secondary" onClick={() => addQueue(item)}>
                    <ListOrdered size={16} />
                    {en ? "Add to relay" : "加入接力"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      void (async () => {
                        try {
                          if (item.imageKey && settings.webdav.clipboardEnabled)
                            await syncDavImage(
                              settings.webdav,
                              item.imageKey,
                              false,
                            );
                          if (await exportClip(item))
                            showToast(en ? "Exported" : "已导出");
                        } catch (e) {
                          showToast(String(e));
                        }
                      })();
                    }}
                  >
                    <Download size={16} />
                    {en ? "Export" : "导出"}
                  </button>
                </div>
                {item.kind !== "image" && item.kind !== "file" && (
                  <div className="clip-transforms">
                    <label>
                      {en ? "Transform text" : "文本处理"}
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const kind = e.target.value;
                          e.target.value = "";
                          if (kind)
                            setEditor({
                              id: item.id,
                              title: item.title ?? "",
                              group: item.group ?? "",
                              text:
                                kind === "upper"
                                  ? item.text.toUpperCase()
                                  : kind === "lower"
                                    ? item.text.toLowerCase()
                                    : kind === "url"
                                      ? cleanTrackingParams(item.text)
                                      : item.text
                                          .split(/\r?\n/)
                                          .filter((s) => s.trim())
                                          .join("\n"),
                            });
                        }}
                      >
                        <option value="">
                          {en ? "Choose…" : "选择处理方式…"}
                        </option>
                        <option value="upper">
                          {en ? "UPPERCASE" : "转大写"}
                        </option>
                        <option value="lower">
                          {en ? "lowercase" : "转小写"}
                        </option>
                        <option value="url">
                          {en ? "Clean URL" : "清理链接跟踪参数"}
                        </option>
                        <option value="blank">
                          {en ? "Remove blank lines" : "移除空白行"}
                        </option>
                      </select>
                    </label>
                    <label>
                      {en ? "Split into relay" : "拆分为接力队列"}
                      <div>
                        <select
                          value={
                            ["\n", ",", "、", ";"].includes(delimiter)
                              ? delimiter
                              : "custom"
                          }
                          onChange={(e) =>
                            setDelimiter(
                              e.target.value === "custom"
                                ? "|"
                                : e.target.value,
                            )
                          }
                        >
                          <option value="\n">{en ? "Newline" : "换行"}</option>
                          <option value=",">{en ? "Comma" : "逗号"}</option>
                          <option value="、">、</option>
                          <option value=";">;</option>
                          <option value="custom">
                            {en ? "Custom" : "自定义"}
                          </option>
                        </select>
                        {!["\n", ",", "、", ";"].includes(delimiter) && (
                          <input
                            aria-label={en ? "Separator" : "分隔符"}
                            value={delimiter}
                            maxLength={20}
                            onChange={(e) => setDelimiter(e.target.value)}
                          />
                        )}
                        <button className="secondary" onClick={() => split()}>
                          {en ? "Split" : "拆分"}
                        </button>
                      </div>
                    </label>
                  </div>
                )}
                </details>
              </>
            ) : (
              <div className="clip-empty">
                {en ? "Select an entry to preview" : "选择一条记录查看内容"}
              </div>
            )}
          </article>
        </div>
        </>
      )}
      <div className="clip-paste-bar">
        <span className="clip-paste-hint">{en ? `${visible.length} entries · ↑↓ select` : `${visible.length} 条记录 · ↑↓ 选择`}</span>
        <div>
          <button className="primary" disabled={controlsDisabled} onClick={() => item && void perform(item, true)}><kbd>↵</kbd>{en ? "Paste" : "粘贴"}</button>
          <button className="secondary" disabled={controlsDisabled} title={en ? "Sends Enter to the target app after pasting" : "粘贴后会在目标应用中按回车，请确认内容"} onClick={() => item && void perform(item, true, false, true)}><kbd>⇧↵</kbd>{en ? "Paste + Enter" : "粘贴并回车"}</button>
          <button className="secondary" disabled={controlsDisabled} onClick={() => item && void perform(item, true, true)}><kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}↵</kbd>{en ? "Plain text" : "纯文本粘贴"}</button>
          <button className="secondary" disabled={controlsDisabled} aria-label={en ? "Quick actions" : "快捷操作"} aria-expanded={Boolean(context)} onClick={(event) => { if (!item) return; const rect = event.currentTarget.getBoundingClientRect(); setGroupEditor(false); setContext(context ? null : { id: item.id, x: rect.right - 230, y: rect.top - 400 }); }}><MoreHorizontal size={17}/><span>{en ? "Actions" : "快捷操作"}</span></button>
        </div>
      </div>
      <footer className="clip-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {en ? "Select" : "选择"}　<kbd>↵</kbd>{" "}
          {en ? "Paste" : "粘贴"}　
          <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} 1–9</kbd>
        </span>
        <span>
          {queueItems.length > 0 ? (
            <>
              <ListOrdered size={14} />
              {en ? "Relay" : "接力"} {queueItems.length}
              <button disabled={working} onClick={() => void next(false)}>
                {en ? "Copy next" : "复制下一条"}
              </button>
              <button disabled={working} onClick={() => void next(true)}>
                {en ? "Paste next" : "粘贴下一条"}
              </button>
              <button
                onClick={() => setQueue([])}
                aria-label={en ? "Clear queue" : "清空队列"}
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <small>
              {en
                ? "Local-first · no cloud until enabled"
                : "本地优先 · 不会默认上传云端"}
            </small>
          )}
        </span>
      </footer>
      {context && contextItem && <div ref={menuRef} className="clip-context-menu" role="menu" aria-label={en ? "Clipboard actions" : "剪贴板操作"} style={{ left: context.x, top: context.y }}>
        <button role="menuitem" disabled={working} onClick={() => { setContext(null); void perform(contextItem); }}><Copy size={16}/>{en ? "Copy" : "复制"}</button>
        <button role="menuitem" onClick={() => { patch(contextItem.id, { pinned: !contextItem.pinned }); setContext(null); }}><Pin size={16}/>{contextItem.pinned ? (en ? "Unpin" : "取消置顶") : (en ? "Pin" : "置顶")}</button>
        <button role="menuitem" onClick={() => { patch(contextItem.id, { sensitive: !contextItem.sensitive }); setRevealed(""); setContext(null); }}><ShieldCheck size={16}/>{contextItem.sensitive ? (en ? "Unmark sensitive" : "取消敏感标记") : (en ? "Mark sensitive" : "标记为敏感")}</button>
        <hr/>
        <button role="menuitem" onClick={() => setGroupEditor(!groupEditor)}><Folder size={16}/>{en ? "Move to group" : "移入分组"}<ArrowRight size={13}/></button>
        {groupEditor && <form className="clip-group-form" onSubmit={(event) => { event.preventDefault(); const group = new FormData(event.currentTarget).get("group") as string; patch(contextItem.id, { group: group.trim().slice(0, 80) || undefined }); setContext(null); }}>
          <input autoFocus name="group" defaultValue={contextItem.group ?? ""} list="clip-groups" maxLength={80} placeholder={en ? "Group name (empty to remove)" : "分组名，留空移出分组"} aria-label={en ? "Group name" : "分组名称"}/>
          <datalist id="clip-groups">{groups.map((group) => <option key={group} value={group}/>)}</datalist>
          <button type="submit">{en ? "Save" : "保存"}</button>
        </form>}
        <button role="menuitem" onClick={() => { addQueue(contextItem); setContext(null); }}><ListOrdered size={16}/>{en ? "Add to relay queue" : "加入接力队列"}</button>
        <button role="menuitem" disabled={contextItem.kind === "image" || contextItem.kind === "file"} onClick={() => { split(contextItem); setContext(null); }}><Type size={16}/>{en ? "Split into relay" : "拆分并接力"}</button>
        <hr/>
        <button role="menuitem" onClick={() => { setContext(null); void setClipboardText(JSON.stringify({ kind: contextItem.kind, createdAt: contextItem.createdAt, characters: contextItem.text.length, files: contextItem.files?.length ?? 0, width: contextItem.width, height: contextItem.height, sensitive: Boolean(contextItem.sensitive), hasHtml: Boolean(contextItem.html), hasImage: Boolean(contextItem.imageKey) }, null, 2)).then(() => showToast(en ? "Diagnostics copied (content excluded)" : "已复制调试信息（不含内容）")).catch((error) => showToast(String(error))); }}><Code2 size={16}/>{en ? "Copy diagnostics" : "复制调试信息"}</button>
        <hr/>
        <button className="danger" role="menuitem" onClick={() => { remove(contextItem.id); setContext(null); }}><Trash2 size={16}/>{en ? "Delete" : "删除"}</button>
      </div>}
      {(editor || clear) && (
        <div
          className="modal-shade"
          data-local-dialog
          onClick={() => {
            setEditor(null);
            setClear(false);
          }}
        >
          <section
            className="clip-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clip-editor-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="clip-close"
              aria-label={en ? "Close" : "关闭"}
              onClick={() => {
                setEditor(null);
                setClear(false);
              }}
            >
              <X />
            </button>
            <h2 id="clip-editor-title">
              {clear
                ? en
                  ? "Clear clipboard history?"
                  : "清空剪贴板历史？"
                : en
                  ? "Edit entry"
                  : "编辑记录"}
            </h2>
            {editor ? (
              <>
                <label className="clip-label">
                  {en ? "Title (optional)" : "标题（可选）"}
                  <input
                    value={editor.title}
                    maxLength={256}
                    onChange={(e) =>
                      setEditor({ ...editor, title: e.target.value })
                    }
                  />
                </label>
                <label className="clip-label">
                  {en ? "Group (optional)" : "分组（可选）"}
                  <input
                    value={editor.group}
                    maxLength={80}
                    onChange={(e) =>
                      setEditor({ ...editor, group: e.target.value })
                    }
                  />
                </label>
                <label className="clip-label">
                  {en ? "Content" : "内容"}
                  <textarea
                    autoFocus
                    value={editor.text}
                    maxLength={250000}
                    onChange={(e) =>
                      setEditor({ ...editor, text: e.target.value })
                    }
                  />
                </label>
              </>
            ) : (
              <p>
                {en
                  ? "All records, including pinned entries, will be removed. Deletions propagate on the next sync. File originals are not deleted."
                  : "将移除全部记录（包括置顶）。删除会在下次同步传递到其他设备，不会删除原始文件。"}
              </p>
            )}
            <div className="clip-actions">
              <button
                className="secondary"
                onClick={() => {
                  setEditor(null);
                  setClear(false);
                }}
              >
                {en ? "Cancel" : "取消"}
              </button>
              <button
                className="primary"
                disabled={Boolean(editor && !editor.id && !editor.text.trim())}
                onClick={() => {
                  if (clear) {
                    const now = Date.now();
                    setClips((c) =>
                      c.map((v) => ({
                        ...v,
                        deletedAt: now,
                        updatedAt: now,
                        text: "",
                        html: undefined,
                        thumbnail: undefined,
                        files: [],
                        title: undefined,
                        group: undefined,
                      })),
                    );
                    setQueue([]);
                    setClear(false);
                  } else if (editor) {
                    if (editor.id)
                      patch(editor.id, {
                        text: editor.text,
                        kind:
                          item?.kind === "image" || item?.kind === "file"
                            ? item.kind
                            : detectClipKind(editor.text),
                        title: editor.title,
                        group: editor.group,
                        html: undefined,
                        sensitive: textClip(editor.text).sensitive,
                      });
                    else
                      setClips((c) =>
                        mergeClips(
                          c,
                          [
                            {
                              ...textClip(editor.text),
                              title: editor.title,
                              group: editor.group,
                            },
                          ],
                          options,
                        ),
                      );
                    setEditor(null);
                  }
                }}
              >
                {en ? (clear ? "Clear" : "Save") : clear ? "清空" : "保存"}
              </button>
            </div>
          </section>
        </div>
      )}
      {pastePermissionHelp && (
        <div className="modal-shade" data-local-dialog onClick={() => setPastePermissionHelp(false)}>
          <section className="clip-dialog" role="dialog" aria-modal="true" aria-labelledby="paste-permission-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            event.preventDefault();
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const index = controls.indexOf(document.activeElement as HTMLButtonElement);
            controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length]?.focus();
          }}>
            <button autoFocus className="clip-close" aria-label={en ? "Close" : "关闭"} onClick={() => setPastePermissionHelp(false)}><X /></button>
            <h2 id="paste-permission-title">{en ? "Allow automatic paste on macOS" : "允许 macOS 自动粘贴"}</h2>
            <p>{permissionRetry ? (en ? "Content is already copied. macOS blocked the simulated paste keystroke; you can paste manually with ⌘V." : "内容已经复制。macOS 阻止了模拟粘贴按键，你仍可切换到目标应用，手动按 ⌘V。") : (en ? "Automatic paste needs permission to send ⌘V to the target app." : "自动粘贴需要获得系统许可，才能向目标应用发送 ⌘V。")}</p>
            <ol className="paste-permission-steps">
              <li>{en ? "System Settings → Privacy & Security → Accessibility: enable Qimiao (启喵). If missing, click + and select Qimiao.app in Applications." : "系统设置 → 隐私与安全性 → 辅助功能：开启 Qimiao（启喵）。找不到时，点击“+”，在“应用程序”中选择 Qimiao.app。"}</li>
              <li>{en ? "If it is already enabled but the check below says access is blocked, remove the old entry and add the currently running app again. macOS can retain an old authorization after an app update or move." : "如果开关已开，但下方检测仍显示未授权，请删除旧条目，再添加当前正在运行的应用。更新或移动应用后，macOS 可能保留旧的授权记录。"}</li>
              <li>{en ? "Focus the destination input, reopen Clipboard with its hotkey, release the modifier keys, and choose an entry. Automatic paste now uses native keyboard events; System Events automation and Input Monitoring are not required." : "点击目标输入框，再用快捷键打开剪贴板，松开修饰键后选择记录。现在使用原生按键粘贴，无需开启 System Events 自动化或输入监控。"}</li>
            </ol>
            <div className="paste-status" role="status">
              {pasteStatus ? (pasteStatus.trusted ? (en ? "Current process: paste permission granted" : "当前运行进程：已获得粘贴权限") : (en ? "Current process: paste permission not granted" : "当前运行进程：未获得粘贴权限")) : pasteStatusError || (en ? "Checking current process permission…" : "正在检测当前进程权限…")}
              {pasteStatus?.executable && <code>{pasteStatus.executable}</code>}
            </div>
            <div className="clip-actions paste-permission-actions">
              <button className="secondary" onClick={() => setPastePermissionHelp(false)}>{en ? "Close" : "关闭"}</button>
              <button className="secondary" onClick={() => void checkPastePermission()}>{en ? "Check again" : "重新检测"}</button>
              <button className="primary" onClick={() => void openMacosPermission("accessibility").catch((error) => showToast(String(error)))}>{en ? "Accessibility" : "打开辅助功能设置"}</button>
              {permissionRetry && <button className="primary" disabled={working} onClick={() => { const retry = permissionRetry; setPastePermissionHelp(false); if (retry) void perform(retry.clip, true, retry.plain, retry.enter); }}>{en ? "Retry paste" : "重试粘贴"}</button>}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
