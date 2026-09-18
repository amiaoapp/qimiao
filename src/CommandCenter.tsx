// SPDX-License-Identifier: AGPL-3.0-or-later
// Command behavior includes compatibility work adapted from TinyCast, Copyright (C) 2026 Abue Ammar.
import { useEffect, useMemo, useState } from "react";
import {
  Calculator, Clipboard, Copy, FileSearch, Keyboard, Lock, Maximize2,
  PanelLeft, PanelRight, Smile, Workflow, Link, NotebookPen, TextQuote, TerminalSquare,
} from "lucide-react";
import type { CommandTool, LauncherMode, Settings } from "./types";
import { calculateExpression, convertUnits, emojiCatalog, matchText, type CommandResult } from "./command-center";
import { expandCompatibleTemplate, normalizeCompatibleDestination, toolArgumentInput, toolMatchesQuery } from "./tinycast-compat";
import {
  listAppleShortcuts, openPath, runAppleShortcut, runSystemAction,
  runWindowAction, searchFiles, setClipboardText, openExternalUrl, runCustomCommand,
} from "./tauri";

type Props = {
  mode: "commands" | "clipboard";
  query: string;
  language: Settings["language"];
  fileSearchDirs: string[];
  clipboardEntries: string[];
  tools: CommandTool[];
  setTools: (tools: CommandTool[]) => void;
  setMode: (mode: LauncherMode) => void;
  showToast: (message: string) => void;
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
  useEffect(() => {
    if (!navigator.userAgent.includes("Mac")) return;
    void listAppleShortcuts().then(setShortcuts).catch(() => setShortcuts([]));
  }, []);
  useEffect(() => {
    const raw = query.replace(/^(file:|f:|文件[:：]?)/i, "").trim();
    const wantsFiles = /^(file:|f:|文件[:：]?)/i.test(query.trim());
    if (!wantsFiles || raw.length < 2) {
      setFiles([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchFiles(raw, fileSearchDirs, 40)
        .then((items) => setFiles(items.map((item) => ({
          id: `file:${item.path}`, title: item.name, subtitle: item.path,
          kind: "file", path: item.path,
        }))))
        .catch(() => setFiles([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, fileSearchDirs]);

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
    const systemActions: CommandResult[] = [
      ["sleep", "Sleep", "睡眠"], ["sleep-displays", "Sleep Displays", "关闭显示器"],
      ["show-screen-saver", "Show Screen Saver", "启动屏幕保护"],
      ["play-pause", "Play / Pause", "播放／暂停"], ["next-track", "Next Track", "下一曲"],
      ["previous-track", "Previous Track", "上一曲"], ["toggle-mute", "Toggle Mute", "静音切换"],
      ["volume-up", "Turn Volume Up", "调高音量"], ["volume-down", "Turn Volume Down", "调低音量"],
      ["show-desktop", "Show Desktop", "显示桌面"], ["open-trash", "Open Trash", "打开废纸篓"],
      ["toggle-hidden-files", "Toggle Hidden Files", "显示／隐藏文件"],
      ["restart", "Restart", "重新启动"], ["shut-down", "Shut Down", "关机"],
      ["log-out", "Log Out", "注销"], ["empty-trash", "Empty Trash", "清空废纸篓"],
    ].map(([action, english, chinese]) => ({
      id: `system:${action}`, title: en ? english : chinese,
      subtitle: en ? "System Action" : "系统操作", kind: "command" as const,
      action: `system:${action}`,
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
      { id: "lock", title: en ? "Lock Screen" : "锁定屏幕", subtitle: en ? "Lock this computer" : "立即锁定这台电脑", kind: "command", action: "lock" },
      { id: "dictionary", title: en ? "Define a Word" : "查询词典", subtitle: en ? "Type dict: followed by a word" : "输入 dict: 后跟单词", kind: "command", action: "dictionary-help" },
      { id: "calendar", title: en ? "Open Calendar" : "打开日历", subtitle: en ? "Open the system calendar" : "打开系统日历", kind: "command", action: "open-calendar" },
      { id: "add-link-help", title: en ? "Add Quicklink" : "添加快速链接", subtitle: "link: title | https://example.com", kind: "command", action: "help-link" },
      { id: "add-snippet-help", title: en ? "Add Snippet" : "添加代码片段", subtitle: en ? "snippet: title | content" : "snippet: 名称 | 内容", kind: "command", action: "help-snippet" },
      { id: "add-note-help", title: en ? "Add Note" : "添加笔记", subtitle: en ? "note: title | body" : "note: 标题 | 正文", kind: "command", action: "help-note" },
      { id: "add-command-help", title: en ? "Add Custom Command" : "添加自定义命令", subtitle: en ? "cmd: title | program | arguments" : "cmd: 名称 | 程序 | 参数", kind: "command", action: "help-command" },
    ];
    const createTool = (() => {
      const match = trimmed.match(/^(link|snippet|note|cmd)[:：]\s*(.+)$/i);
      if (!match) return null;
      const values = match[2].split("|").map((value) => value.trim());
      const type = match[1].toLowerCase();
      if (type === "link" && values.length >= 2 && /^https?:\/\//i.test(values[1]))
        return { type: "quicklink", title: values[0], content: values[1] } as const;
      if ((type === "snippet" || type === "note") && values.length >= 2)
        return { type, title: values[0], content: values.slice(1).join(" | ") } as const;
      if (type === "cmd" && values.length >= 2)
        return { type: "custom", title: values[0], content: values[1], args: values.slice(2).join(" ").split(/\s+/).filter(Boolean) } as const;
      return null;
    })();
    const toolResults: CommandResult[] = tools
      .filter((tool) => tool.enabled !== false && tool.showsInRootSearch !== false)
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
    const dictionaryMatch = trimmed.match(/^(?:dict|define|词典|释义)[:：]?\s+(.+)$/i);
    return [
      ...(calculator === null ? [] : [{ id: "calculation", title: String(calculator), subtitle: trimmed, kind: "calculator" as const, value: String(calculator) }]),
      ...(conversion === null ? [] : [{
        id: "conversion", title: `${Number(conversion.value.toPrecision(12))} ${conversion.to}`,
        subtitle: trimmed, kind: "calculator" as const,
        value: `${Number(conversion.value.toPrecision(12))} ${conversion.to}`,
      }]),
      ...(dictionaryMatch ? [{
        id: "dictionary-result", title: en ? `Define “${dictionaryMatch[1]}”` : `查询“${dictionaryMatch[1]}”`,
        subtitle: en ? "Open dictionary definition" : "打开词典释义", kind: "command" as const,
        action: "dictionary", value: dictionaryMatch[1].trim(),
      }] : []),
      ...(createTool === null ? [] : [{
        id: "create-tool", title: en ? `Save “${createTool.title}”` : `保存“${createTool.title}”`,
        subtitle: en ? `Add ${createTool.type} to qimiao` : `添加到启喵命令库`,
        kind: createTool.type, action: "create-tool", value: JSON.stringify(createTool),
      } as CommandResult]),
      ...files,
      ...toolResults,
      ...[...base, ...systemActions, ...windowActions].filter((item) => !trimmed || matchText(`${item.title} ${item.subtitle}`, trimmed)),
      ...shortcutResults,
      ...emoji,
    ];
  }, [mode, clipboardEntries, query, files, shortcuts, tools, en]);
  useEffect(() => setSelected(0), [query, mode]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || !results.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        void activate(results[selected] ?? results[0]);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  });
  async function activate(result: CommandResult) {
    try {
      if (result.action === "clipboard") return setMode("clipboard");
      if (result.action === "files") return showToast(en ? "Type file: followed by a filename" : "请输入 file:文件名");
      if (result.action === "dictionary-help") return showToast(en ? "Type dict: followed by a word" : "请输入 dict:单词");
      if (result.action === "open-calendar") {
        await openExternalUrl(navigator.userAgent.includes("Mac") ? "x-apple-calevent://" : "https://calendar.google.com/");
        return;
      }
      if (result.action?.startsWith("help-")) return showToast(result.subtitle);
      if (result.action === "create-tool" && result.value) {
        const tool = JSON.parse(result.value) as Omit<CommandTool, "id">;
        setTools([...tools, { ...tool, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }]);
        return showToast(en ? "Saved to Command Center" : "已保存到命令中心");
      }
      if (result.action === "lock") await runSystemAction("lock");
      else if (result.action?.startsWith("system:")) {
        const action = result.action.slice(7);
        if (["restart", "shut-down", "log-out", "empty-trash"].includes(action)
          && !window.confirm(en ? `Run “${result.title}”?` : `确认执行“${result.title}”？`)) return;
        await runSystemAction(action);
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
        else await openExternalUrl(destination);
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
        await setClipboardText(expanded.value);
      }
      else if (result.action === "tool-note" && result.path) await setClipboardText(result.path);
      else if (result.action === "tool-custom" && result.path) {
        const tool = tools.find((candidate) => `tool:${candidate.id}` === result.id);
        if (tool?.requiresConfirmation && !window.confirm(en ? `Run “${tool.title}”?` : `运行“${tool.title}”？`)) return;
        const supplied = toolArgumentInput(query, tool);
        const args = supplied ? [supplied] : JSON.parse(result.value ?? "[]") as string[];
        await runCustomCommand(result.path, args);
      }
      else if (result.kind === "file" && result.path) await openPath(result.path);
      else if (result.kind === "shortcut" && result.value) await runAppleShortcut(result.value);
      else if (result.action === "dictionary" && result.value) await openExternalUrl(
        navigator.userAgent.includes("Mac")
          ? `dict://${encodeURIComponent(result.value)}`
          : `https://www.google.com/search?q=${encodeURIComponent(`define ${result.value}`)}`,
      );
      else if (result.value) await setClipboardText(result.value);
      showToast(en ? "Done" : "已完成");
    } catch (error) {
      showToast(`${en ? "Failed" : "操作失败"}：${String(error)}`);
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
      <div className="command-results">
        {results.length ? results.map((result, index) => (
          <button key={result.id} className={index === selected ? "selected" : ""} onMouseEnter={() => setSelected(index)} onClick={() => void activate(result)} onContextMenu={(event) => {
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
    </section>
  );
}
