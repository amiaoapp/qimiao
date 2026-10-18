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
import { copyClip, exportClip, syncDavImage } from "./tauri";
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
            Number(b.pinned) - Number(a.pinned) ||
            (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt),
        ),
    [active, filter, query],
  );
  const item = visible.find((c) => c.id === selected) ?? visible[0];
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
      showToast(String(error));
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
        editor ||
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
        void perform(item, true, event.altKey, event.shiftKey);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function addQueue(c: Clip) {
    setQueue((q) => (q.includes(c.id) ? q : [...q, c.id]));
  }
  function split() {
    if (!item) return;
    const parts = splitRelayText(item.text, delimiter);
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
        <div className="clip-body">
          <nav
            className="clip-sidebar"
            aria-label={en ? "Clipboard filters" : "剪贴板筛选"}
          >
            {(
              [
                ["all", Clipboard, en ? "All entries" : "全部记录"],
                ["pinned", Pin, en ? "Pinned" : "置顶"],
                ["favorite", Star, en ? "Favorites" : "收藏"],
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
            <hr />
            {(Object.keys(clipKindLabels) as ClipKind[]).map((kind) => {
              const Icon = icons[kind];
              return (
                <button
                  key={kind}
                  className={filter === kind ? "active" : ""}
                  onClick={() => setFilter(kind)}
                >
                  <Icon size={16} />
                  <span>{clipKindLabels[kind][en ? 1 : 0]}</span>
                  <small>{active.filter((c) => c.kind === kind).length}</small>
                </button>
              );
            })}
            {groups.length > 0 && <hr />}
            {groups.map((group) => (
              <button
                key={group}
                className={filter === `group:${group}` ? "active" : ""}
                onClick={() => setFilter(`group:${group}`)}
              >
                <Hash size={16} />
                <span>{group}</span>
              </button>
            ))}
          </nav>
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
                const Icon = icons[c.kind];
                return (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={item?.id === c.id}
                    ref={item?.id === c.id ? selectedRef : undefined}
                    className={`clip-entry ${item?.id === c.id ? "selected" : ""}`}
                    onClick={() => setSelected(c.id)}
                    onDoubleClick={() => void perform(c, true)}
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
                        {c.title ||
                          (c.sensitive
                            ? en
                              ? "Sensitive content"
                              : "敏感内容"
                            : c.kind === "image"
                              ? `${en ? "Image" : "图片"} ${c.width ?? ""} × ${c.height ?? ""}`
                              : c.kind === "file"
                                ? c.files
                                    ?.map((p) => p.split(/[\\/]/).pop())
                                    .join(", ")
                                : c.text.slice(0, 120))}
                      </strong>
                      <small>
                        {c.sourceApp || clipKindLabels[c.kind][en ? 1 : 0]} ·{" "}
                        {new Date(c.createdAt).toLocaleDateString()}{" "}
                        {c.group ? `· ${c.group}` : ""}
                      </small>
                    </span>
                    <span className="clip-entry-flags">
                      {c.pinned && <Pin size={12} />}{" "}
                      {c.favorite && <Star size={12} />}{" "}
                      {index < 9 && <kbd>{index + 1}</kbd>}
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
                  <span>{clipKindLabels[item.kind][en ? 1 : 0]}</span>
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
                    <pre>{item.files?.join("\n")}</pre>
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
                    {item.kind === "image"
                      ? `${item.width} × ${item.height}`
                      : `${item.text.length} ${en ? "characters" : "字符"}`}
                  </dd>
                </dl>
                <div className="clip-actions">
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
                        <button className="secondary" onClick={split}>
                          {en ? "Split" : "拆分"}
                        </button>
                      </div>
                    </label>
                  </div>
                )}
              </>
            ) : (
              <div className="clip-empty">
                {en ? "Select an entry to preview" : "选择一条记录查看内容"}
              </div>
            )}
          </article>
        </div>
      )}
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
    </section>
  );
}
