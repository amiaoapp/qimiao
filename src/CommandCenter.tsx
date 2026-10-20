// SPDX-License-Identifier: AGPL-3.0-or-later
// Command behavior includes compatibility work adapted from TinyCast, Copyright (C) 2026 Abue Ammar.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calculator, Clipboard, Copy, FileSearch, Keyboard, Lock, Maximize2,
  PanelLeft, PanelRight, Smile, Workflow, Link, NotebookPen, TextQuote, TerminalSquare,
} from "lucide-react";
import type { CommandTool, LauncherMode, Settings } from "./types";
import { calculateExpression, convertUnits, dictionaryTerm, splitCommandArguments, textUtility, emojiCatalog, matchText, type CommandResult } from "./command-center";
import { expandCompatibleTemplate, normalizeCompatibleDestination, toolArgumentInput, toolMatchesQuery } from "./tinycast-compat";
import { availableSystemActions, type SystemAction, type DesktopPlatform } from "./system-actions";
import {
  listAppleShortcuts, openPath, runAppleShortcut,
  runWindowAction, searchFiles, setClipboardText, openExternalUrl, runCustomCommand,
} from "./tauri";

type Props = {
  mode: "commands" | "clipboard";
  query: string;
  setQuery: (query: string) => void;
  platform: DesktopPlatform;
  imeActive: () => boolean;
  language: Settings["language"];
  fileSearchDirs: string[];
  clipboardEntries: string[];
  tools: CommandTool[];
  setTools: (tools: CommandTool[]) => void;
  setMode: (mode: LauncherMode) => void;
  showToast: (message: string) => void;
  onSystemAction: (action: SystemAction) => void;
  blocked: boolean;
};

const iconFor = (result: CommandResult) => {
  if (result.kind === "calculator") return <Calculator />;
  if (result.kind === "clipboard") return <Clipboard />;
  if (result.kind === "emoji") return <Smile />;
  if (result.kind === "file") return <FileSearch />;
  if (result.kind === "shortcut") return <Workflow />;
  if (result.kind === "quicklink") return <Link />;
  if (result.kind === "snippet") return <TextQuote />;
  if (result.kind === "note") return <NotebookPen />;
  if (result.kind === "custom") return <TerminalSquare />;
  if (result.action === "lock") return <Lock />;
  if (result.action === "left") return <PanelLeft />;
  if (result.action === "right") return <PanelRight />;
  if (result.action === "maximize") return <Maximize2 />;
  return <Keyboard />;
};

export default function CommandCenter(props: Props) {
  const { mode, query, language, fileSearchDirs, clipboardEntries, tools, setTools, setMode, showToast } = props;
  const en = language === "en";
  const [selected, setSelected] = useState(0);
  const [files, setFiles] = useState<CommandResult[]>([]);
  const [shortcuts, setShortcuts] = useState<string[]>([]);
  const [fileStatus, setFileStatus] = useState("");
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (props.platform !== "macos") return;
    void listAppleShortcuts().then(setShortcuts).catch(() => setShortcuts([]));
  }, [props.platform]);
  useEffect(() => {
    const raw = query.trim().replace(/^(file:|f:|文件[:：]?)/i, "").trim();
    const wantsFiles = /^(file:|f:|文件[:：]?)/i.test(query.trim());
    let cancelled = false;
    setFiles([]);
    if (!wantsFiles || raw.length < 2) {
      setFiles([]);
      setFileStatus(wantsFiles ? (en ? "Enter at least 2 characters" : "请输入至少两个字符的文件名") : "");
      return;
    }
    setFileStatus(en ? "Searching local files…" : "正在搜索本机文件…");
    const timer = window.setTimeout(() => {
      void searchFiles(raw, fileSearchDirs, 40)
        .then((items) => { if (cancelled) return; setFileStatus(items.length ? "" : (en ? "No files found in the configured folders" : "搜索目录中没有找到匹配文件，可在设置中调整目录")); setFiles(items.map((item) => ({
          id: `file:${item.path}`, title: item.name, subtitle: item.path,
          kind: "file", path: item.path,
        }))); })
        .catch((error) => { if (!cancelled) setFileStatus(String(error)); });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, fileSearchDirs, en]);

  const results = useMemo<CommandResult[]>(() => {
    if (mode === "clipboard") {
      return clipboardEntries
        .filter((text) => matchText(text, query))
        .map((text, index) => ({
          id: `clipboard:${index}:${text.slice(0, 16)}`, title: text.split("\n")[0].slice(0, 100),
          subtitle: text.length > 100 ? text.slice(100, 220) : en ? "Copy to clipboard" : "复制到剪贴板",
          kind: "clipboard", value: text,
        }));
    }
    const trimmed = query.trim();
    const calculator = calculateExpression(trimmed);
    const conversion = convertUnits(trimmed);
    const utility = textUtility(trimmed, en);
    const systemActions: CommandResult[] = availableSystemActions(props.platform).map((action) => ({
      id: `system:${action.id}`, title: en ? action.en : action.zh,
      subtitle: en ? "System Action" : "系统操作", kind: "command" as const,
      action: `system:${action.id}`, searchTerms: `${action.zh} ${action.en} ${action.aliases}`,
    }));
    const windowActions: CommandResult[] = [
      ["left", "Window: Left Half", "窗口：左半屏"], ["right", "Window: Right Half", "窗口：右半屏"],
      ["top", "Window: Top Half", "窗口：上半屏"], ["bottom", "Window: Bottom Half", "窗口：下半屏"],
      ["center", "Window: Center", "窗口：居中"], ["maximize", "Window: Maximize", "窗口：最大化"],
      ["almost-maximize", "Window: Almost Maximize", "窗口：近似最大化"],
      ["maximize-width", "Window: Maximize Width", "窗口：最大宽度"],
      ["maximize-height", "Window: Maximize Height", "窗口：最大高度"],
    ].map(([action, english, chinese]) => ({
      id: `window:${action}`, title: en ? english : chinese,
      subtitle: en ? "Move or resize the active window" : "移动或调整当前窗口",
      kind: "command" as const, action: `window:${action}`,
    }));
    const base: CommandResult[] = [
      { id: "clipboard", title: en ? "Clipboard History" : "剪贴板历史", subtitle: en ? "Search and paste recent text" : "搜索并复制最近的文本", kind: "command", action: "clipboard" },
      { id: "files", title: en ? "Search Files" : "搜索文件", subtitle: en ? "Type file: followed by a name" : "输入 file: 后跟文件名", kind: "command", action: "files" },
      { id: "dictionary", title: en ? "Define a Word" : "查询词典", subtitle: en ? "Type dict: followed by a word" : "输入 dict: 后跟单词", kind: "command", action: "dictionary-help" },
      { id: "calendar", title: en ? "Open Calendar" : "打开日历", subtitle: en ? "Open the system calendar" : "打开系统日历", kind: "command", action: "open-calendar" },
      { id: "json-help", title: en ? "Format JSON" : "格式化 JSON", subtitle: 'json: {"hello":"world"}', kind: "command", action: "help-json" },
      { id: "base64-help", title: en ? "Encode Base64" : "Base64 编码", subtitle: en ? "base64: text (UTF-8)" : "base64: 文本，支持中文 UTF-8", kind: "command", action: "help-base64" },
      { id: "decode64-help", title: en ? "Decode Base64" : "Base64 解码", subtitle: "decode64: SGVsbG8=", kind: "command", action: "help-decode64" },
      { id: "time-help", title: en ? "Convert Timestamp" : "时间戳转换", subtitle: en ? "time: now / Unix seconds / milliseconds / ISO date" : "time: now / 秒时间戳 / 毫秒时间戳 / ISO 日期", kind: "command", action: "help-time" },
      { id: "units-help", title: en ? "Convert Units" : "单位换算", subtitle: en ? "Length, mass, data, time & temperature: 100 c to f" : "长度、重量、数据、时间、温度，如 100 c to f", kind: "command", action: "help-units" },
      { id: "add-link-help", title: en ? "Add Quicklink" : "添加快速链接", subtitle: "link: title | https://example.com", kind: "command", action: "help-link" },
      { id: "add-snippet-help", title: en ? "Add Snippet" : "添加代码片段", subtitle: en ? "snippet: title | content" : "snippet: 名称 | 内容", kind: "command", action: "help-snippet" },
      { id: "add-note-help", title: en ? "Add Note" : "添加笔记", subtitle: en ? "note: title | body" : "note: 标题 | 正文", kind: "command", action: "help-note" },
      { id: "add-command-help", title: en ? "Add Custom Command" : "添加自定义命令", subtitle: en ? "cmd: title | program | arguments" : "cmd: 名称 | 程序 | 参数", kind: "command", action: "help-command" },
    ];
    const createTool = (() => {
      const match = trimmed.match(/^(link|snippet|note|cmd)[:：]\s*(.+)$/i);
      if (!match) return null;
      const values = match[2].split("|").map((value) => value.trim());
      if (!values[0] || !values[1]) return null;
      const type = match[1].toLowerCase();
      if (type === "link" && values.length >= 2 && /^https?:\/\//i.test(values[1]))
        return { type: "quicklink", title: values[0], content: values[1] } as const;
      if ((type === "snippet" || type === "note") && values.length >= 2)
        return { type, title: values[0], content: values.slice(1).join(" | ") } as const;
      if (type === "cmd" && values.length >= 2)
        { const args = splitCommandArguments(values.slice(2).join(" | ")); return args ? { type: "custom", title: values[0], content: values[1], args, requiresConfirmation: true, showsOutput: true } as const : null; }
      return null;
    })();
    const toolResults: CommandResult[] = tools
      // The command center is the full library. `showsInRootSearch` only
      // controls mixed launcher search in TinyCast and must not hide an
      // imported command from its dedicated library.
      .filter((tool) => tool.enabled !== false)
      .filter((tool) => toolMatchesQuery(tool, trimmed))
      .map((tool) => ({
        id: `tool:${tool.id}`, title: tool.title, subtitle: tool.content,
        kind: tool.type, value: tool.type === "custom" ? JSON.stringify(tool.args ?? []) : tool.content,
        path: tool.content, action: `tool-${tool.type}`,
      }));
    const emojiQuery = trimmed.replace(/^(emoji:|表情[:：]?)/i, "").trim();
    const wantsEmoji = /^(emoji:|表情[:：]?)/i.test(trimmed);
    const emoji = (wantsEmoji ? emojiCatalog : trimmed ? [] : emojiCatalog.slice(0, 6))
      .filter(([symbol, words]) => !emojiQuery || matchText(`${symbol} ${words}`, emojiQuery))
      .map(([symbol, words]) => ({ id: `emoji:${symbol}`, title: symbol, subtitle: words, kind: "emoji" as const, value: symbol }));
    const shortcutQuery = trimmed.replace(/^(shortcut:|捷径[:：]?)/i, "").trim();
    const wantsShortcuts = /^(shortcut:|捷径[:：]?)/i.test(trimmed);
    const shortcutResults = shortcuts
      .filter((name) => (wantsShortcuts || !trimmed) && matchText(name, shortcutQuery))
      .slice(0, 15)
      .map((name) => ({ id: `shortcut:${name}`, title: name, subtitle: en ? "Apple Shortcut" : "Apple 快捷指令", kind: "shortcut" as const, value: name }));
    const term = dictionaryTerm(trimmed);
    return [
      ...(utility ? [utility] : []),
      ...(calculator === null ? [] : [{ id: "calculation", title: String(calculator), subtitle: trimmed, kind: "calculator" as const, value: String(calculator) }]),
      ...(conversion === null ? [] : [{
        id: "conversion", title: `${Number(conversion.value.toPrecision(12))} ${conversion.to}`,
        subtitle: trimmed, kind: "calculator" as const,
        value: `${Number(conversion.value.toPrecision(12))} ${conversion.to}`,
      }]),
      ...(term ? [{
        id: "dictionary-result", title: en ? `Define “${term}”` : `查询“${term}”`,
        subtitle: en ? "Open dictionary definition" : "打开词典释义", kind: "command" as const,
        action: "dictionary", value: term,
      }] : []),
      ...(createTool === null ? [] : [{
        id: "create-tool", title: en ? `Save “${createTool.title}”` : `保存“${createTool.title}”`,
        subtitle: en ? `Add ${createTool.type} to qimiao` : `添加到启喵命令库`,
        kind: createTool.type, action: "create-tool", value: JSON.stringify(createTool),
      } as CommandResult]),
      ...files,
      ...toolResults,
      ...[...base, ...systemActions, ...windowActions].filter((item) => !trimmed || matchText(`${item.title} ${item.subtitle} ${item.searchTerms ?? ""}`, trimmed)),
      ...shortcutResults,
      ...emoji,
    ];
  }, [mode, clipboardEntries, query, files, shortcuts, tools, en, props.platform]);
  useEffect(() => setSelected(0), [query, mode]);
  useEffect(() => setSelected((index) => Math.min(index, Math.max(0, results.length - 1))), [results.length]);
  useEffect(() => { selectedRef.current?.scrollIntoView({ block: "nearest" }); }, [selected, results]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (props.blocked || busyRef.current || output || event.defaultPrevented || event.isComposing || event.keyCode === 229 || props.imeActive() || !results.length) return;
      if ((event.target as Element)?.closest("textarea, select, [data-local-dialog], [contenteditable=true]")) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
      } else if (event.key === "Enter" && !event.repeat) {
        event.preventDefault();
        void activate(results[selected] ?? results[0]);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  });
  async function activate(result: CommandResult) {
    if (busyRef.current || props.blocked) return;
    busyRef.current = true; setBusy(true);
    try {
      if (result.action === "input-error") return showToast(result.subtitle);
      if (result.action === "preview-output") return setOutput({ title: result.title, text: result.value ?? "" });
      if (result.action === "clipboard") return setMode("clipboard");
      if (result.action === "files") return props.setQuery("file: ");
      if (result.action === "dictionary-help") return props.setQuery("dict: ");
      if (result.action === "open-calendar") {
        await openExternalUrl(props.platform === "macos" ? "x-apple-calevent://" : "https://calendar.google.com/");
        return;
      }
      if (result.action?.startsWith("help-")) {
        const prefix = ({ "help-link": "link", "help-snippet": "snippet", "help-note": "note", "help-command": "cmd", "help-json": "json", "help-base64": "base64", "help-decode64": "decode64", "help-time": "time" } as Record<string, string>)[result.action];
        props.setQuery(result.action === "help-units" ? "100 c to f" : result.action === "help-time" ? "time: now" : `${prefix}: `);
        return showToast(result.subtitle);
      }
      if (result.action === "create-tool" && result.value) {
        const tool = JSON.parse(result.value) as Omit<CommandTool, "id">;
        setTools([...tools, { ...tool, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }]);
        props.setQuery("");
        return showToast(en ? "Saved to Command Center" : "已保存到命令中心");
      }
      if (result.action?.startsWith("system:")) {
        const action = result.action.slice(7);
        const available = availableSystemActions(props.platform);
        const item = available.find((candidate) => candidate.id === action);
        if (item) props.onSystemAction(item);
        return;
      }
      else if (result.action?.startsWith("window:")) await runWindowAction(result.action.slice(7));
      else if (result.action === "tool-quicklink" && result.path) {
        const tool = tools.find((candidate) => `tool:${candidate.id}` === result.id);
        const expanded = await expandCompatibleTemplate(tool?.content ?? result.path, {
          argument: toolArgumentInput(query, tool),
          clipboard: clipboardEntries[0] ?? "",
          snippets: tools,
          urlEncode: true,
        });
        if (expanded.missingArguments.length) {
          return showToast(en
            ? `Type a value after “${tool?.keyword ?? tool?.alias ?? tool?.title}”`
            : `请在“${tool?.keyword ?? tool?.alias ?? tool?.title}”后输入参数`);
        }
        const destination = normalizeCompatibleDestination(expanded.value);
        if (/^(~\/|\/|file:\/\/|[a-z]:[\\/])/i.test(destination)) await openPath(destination.replace(/^file:\/\//, ""));
        else await openExternalUrl(destination, tool?.openWithBundleID);
      }
      else if (result.action === "tool-snippet" && result.path) {
        const tool = tools.find((candidate) => `tool:${candidate.id}` === result.id);
        const expanded = await expandCompatibleTemplate(tool?.content ?? result.path, {
          argument: toolArgumentInput(query, tool), clipboard: clipboardEntries[0] ?? "", snippets: tools,
        });
        if (expanded.missingArguments.length) {
          return showToast(en
            ? `Type a value after “${tool?.keyword ?? tool?.title}”`
            : `请在“${tool?.keyword ?? tool?.title}”后输入参数`);
        }
        if (tool?.showsConfirmation
          && !window.confirm(en ? `Copy “${tool.title}”?` : `复制“${tool.title}”？`)) return;
        await setClipboardText(expanded.value);
      }
      else if (result.action === "tool-note" && result.path) await setClipboardText(result.path);
      else if (result.action === "tool-custom" && result.path) {
        const tool = tools.find((candidate) => `tool:${candidate.id}` === result.id);
        const supplied = toolArgumentInput(query, tool);
        const expansionContext = {
          argument: supplied,
          clipboard: clipboardEntries[0] ?? "",
          snippets: tools,
        };
        const expandedCommand = await expandCompatibleTemplate(result.path, expansionContext);
        if (expandedCommand.missingArguments.length) {
          return showToast(en
            ? `Type a value after “${tool?.keyword ?? tool?.alias ?? tool?.title}”`
            : `请在“${tool?.keyword ?? tool?.alias ?? tool?.title}”后输入参数`);
        }
        const configuredArgs = tool?.args ?? JSON.parse(result.value ?? "[]") as string[];
        const argResults = await Promise.all(configuredArgs.map((arg) => expandCompatibleTemplate(arg, expansionContext)));
        const directoryResult = tool?.workingDirectory ? await expandCompatibleTemplate(tool.workingDirectory, expansionContext) : null;
        if (argResults.some((result) => result.missingArguments.length) || directoryResult?.missingArguments.length)
          return showToast(en ? "Missing command arguments" : "请在命令名称后补齐参数");
        const expandedArgs = argResults.map((result) => result.value);
        const commandContainsArgument = /\{\s*(?:argument|query)\b/i.test(result.path);
        const args = supplied && !commandContainsArgument && !expandedArgs.length
          ? [supplied]
          : expandedArgs;
        const workingDirectory = directoryResult?.value;
        if ((tool?.requiresConfirmation || tool?.showsConfirmation)
          && !window.confirm(en ? `Run “${tool.title}”?` : `运行“${tool.title}”？`)) return;
        const output = await runCustomCommand(
          expandedCommand.value,
          args,
          workingDirectory,
          tool?.showsOutput === true,
        );
        if (output.trim()) {
          setOutput({ title: result.title, text: output });
          return;
        }
        return showToast(tool?.showsOutput ? (en ? "Completed (no output)" : "已执行完成（无输出）") : (en ? "Command started in background" : "命令已在后台启动，未等待结束"));
      }
      else if (result.kind === "file" && result.path) await openPath(result.path);
      else if (result.kind === "shortcut" && result.value) await runAppleShortcut(result.value);
      else if (result.action === "dictionary" && result.value) await openExternalUrl(
        props.platform === "macos"
          ? `dict://${encodeURIComponent(result.value)}`
          : `https://www.google.com/search?q=${encodeURIComponent(`define ${result.value}`)}`,
      );
      else if (result.value) await setClipboardText(result.value);
      showToast(en ? "Done" : "已完成");
    } catch (error) {
      showToast(`${en ? "Failed" : "操作失败"}：${String(error)}`);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  return (
    <section className="command-center">
      <header>
        <div>
          <strong>{mode === "clipboard" ? (en ? "Clipboard History" : "剪贴板历史") : (en ? "Command Center" : "命令中心")}</strong>
          <span>{en ? "↑↓ select · Enter run · Tab switch" : "↑↓ 选择 · 回车执行 · Tab 切换"}</span>
        </div>
        <kbd>{results.length}</kbd>
      </header>
      {fileStatus && <p className="command-status" role="status">{fileStatus}</p>}
      {busy && <p className="command-status" role="status">{en ? "Running…" : "正在执行…"}</p>}
      <div className="command-results">
        {results.length ? results.map((result, index) => (
          <button key={result.id} ref={index === selected ? selectedRef : undefined} disabled={busy || props.blocked} className={index === selected ? "selected" : ""} onMouseEnter={() => setSelected(index)} onClick={() => void activate(result)} onContextMenu={(event) => {
            if (!result.id.startsWith("tool:")) return;
            event.preventDefault();
            if (window.confirm(en ? `Remove “${result.title}”?` : `删除“${result.title}”？`))
              setTools(tools.filter((tool) => `tool:${tool.id}` !== result.id));
          }}>
            <span className="command-icon">{iconFor(result)}</span>
            <span className="command-copy"><strong>{result.title}</strong><small>{result.subtitle}</small></span>
            <kbd>{index === selected ? "↵" : ""}</kbd>
          </button>
        )) : <div className="command-empty">{en ? "No matching results" : "没有匹配结果"}</div>}
      </div>
      {output && <div className="modal-shade" data-local-dialog onClick={() => setOutput(null)}>
        <section className="clip-dialog command-output" role="dialog" aria-modal="true" aria-label={output.title} onClick={(event) => event.stopPropagation()}>
          <button className="clip-close" aria-label={en ? "Close" : "关闭"} onClick={() => setOutput(null)}>×</button>
          <h3>{output.title}</h3><pre>{output.text}</pre>
          <button className="secondary" onClick={() => void setClipboardText(output.text).then(() => showToast(en ? "Copied" : "已复制")).catch((error) => showToast(String(error)))}><Copy size={16}/>{en ? "Copy output" : "复制输出"}</button>
        </section>
      </div>}
    </section>
  );
}
