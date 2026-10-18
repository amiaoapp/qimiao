import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  Maximize2,
  SlidersHorizontal,
  ClipboardList,
  Command,
  Plus,
  Clock3,
  ArrowUpRight,
  Calculator,
  Terminal,
} from "lucide-react";
import type { AppItem, CommandTool } from "./types";
import {
  compactResults,
  type CommonCommand,
  type CompactResult,
  type RecentCommand,
} from "./compact-results";
import type { DesktopPlatform, SystemAction } from "./system-actions";
import AppGlyph from "./AppGlyph";

export default function CompactLauncher({
  apps,
  query,
  setQuery,
  en,
  platform,
  tools,
  history,
  inputRef,
  onExpand,
  onApp,
  onCommon,
  onSystem,
  onTool,
  onCopy,
  imeActive,
  onCompositionStart,
  onCompositionEnd,
  blocked,
}: {
  apps: AppItem[];
  query: string;
  setQuery: (q: string) => void;
  en: boolean;
  platform: DesktopPlatform;
  tools: CommandTool[];
  history: RecentCommand[];
  inputRef: React.RefObject<HTMLInputElement>;
  onExpand: () => void;
  onApp: (app: AppItem) => void;
  onCommon: (id: CommonCommand) => void;
  onSystem: (action: SystemAction) => void;
  onTool: (tool: CommandTool) => void;
  onCopy: (text: string) => void;
  imeActive: () => boolean;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  blocked: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const rows = useMemo(
    () => compactResults(apps, query, en, platform, tools, history),
    [apps, query, en, platform, tools, history],
  );
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const activate = (row: CompactResult) => {
    if (row.app) onApp(row.app);
    else if (row.system) onSystem(row.system);
    else if (row.common) onCommon(row.common);
    else if (row.tool) onTool(row.tool);
    else if (row.value !== undefined) onCopy(row.value);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        blocked ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        imeActive()
      )
        return;
      const target = event.target as HTMLElement;
      const button = target.closest("button");
      if (button && !button.classList.contains("compact-result")) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((v) =>
          Math.max(
            0,
            Math.min(rows.length - 1, v + (event.key === "ArrowDown" ? 1 : -1)),
          ),
        );
      } else if (event.key === "Enter" && rows.length) {
        event.preventDefault();
        activate(rows[Math.min(selected, rows.length - 1)]);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  let previous = "";
  return (
    <section
      className="compact-launcher"
      aria-label={en ? "Compact launcher" : "简洁启动台"}
    >
      <div className="compact-search" data-window-drag>
        <Search size={20} />
        <input
          autoFocus
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={en ? "Search apps and commands…" : "搜索应用或命令…"}
          aria-label={en ? "Search apps and commands" : "搜索应用或命令"}
        />
        {query && (
          <button
            aria-label={en ? "Clear search" : "清除搜索"}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X />
          </button>
        )}
        <button
          aria-label={en ? "Expand launcher" : "展开启动台"}
          title={en ? "Expand launcher" : "展开启动台"}
          onClick={onExpand}
        >
          <Maximize2 />
        </button>
        <button
          aria-label={en ? "Settings" : "设置"}
          title={en ? "Settings" : "设置"}
          onClick={() => onCommon("settings")}
        >
          <SlidersHorizontal />
        </button>
      </div>
      <div
        className="compact-results"
        role="listbox"
        aria-label={en ? "Search and recent history" : "搜索与历史记录"}
      >
        {!query.trim() && !rows.some((r) => r.section === "history") && (
          <div className="compact-history-empty">
            <Clock3 size={16} />
            {en
              ? "Recently opened apps will appear here"
              : "最近打开的应用会显示在这里"}
          </div>
        )}
        {rows.map((row, index) => {
          const heading = previous !== row.section;
          previous = row.section;
          const Icon =
            row.value !== undefined
              ? Calculator
              : row.common === "clipboard"
                ? ClipboardList
                : row.common === "settings"
                  ? SlidersHorizontal
                  : row.common === "add-app"
                    ? Plus
                    : row.system
                      ? Terminal
                      : Command;
          return (
            <div key={`${row.section}:${row.id}`}>
              {heading && (
                <h3>
                  {row.section === "history"
                    ? en
                      ? "Recently opened"
                      : "最近打开"
                    : row.section === "commands"
                      ? en
                        ? "Common commands"
                        : "常用命令"
                      : en
                        ? "Results"
                        : "搜索结果"}
                </h3>
              )}
              <button
                ref={index === selected ? selectedRef : undefined}
                className={`compact-result ${index === selected ? "selected" : ""}`}
                role="option"
                aria-selected={index === selected}
                onMouseMove={() => setSelected(index)}
                onClick={() => activate(row)}
              >
                {row.app ? (
                  <AppGlyph app={row.app} />
                ) : (
                  <span className="compact-command-icon">
                    <Icon size={18} />
                  </span>
                )}
                <span className="compact-result-copy">
                  <strong>{row.title}</strong>
                  <small>{row.subtitle}</small>
                </span>
                <span className="compact-result-hint">
                  {index === selected ? (
                    <kbd>↵</kbd>
                  ) : (
                    <ArrowUpRight size={14} />
                  )}
                </span>
              </button>
            </div>
          );
        })}
        {!rows.length && (
          <div className="compact-history-empty">
            {en ? "No matching apps or commands" : "没有匹配的应用或命令"}
          </div>
        )}
      </div>
      <footer className="compact-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          {en ? "Select" : "选择"}
          <kbd>↵</kbd>
          {en ? "Open" : "打开"}
        </span>
        <span>
          <kbd>esc</kbd>
          {en ? "Hide" : "收起"}
        </span>
      </footer>
    </section>
  );
}
