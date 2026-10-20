import { useEffect, useRef } from "react";
import { ChevronDown, X } from "lucide-react";
import AppGlyph from "./AppGlyph";
import { appDisplayName } from "./app-catalog";
import type { AppItem, Settings } from "./types";

export default function PinnedStack({
  apps,
  language,
  expanded,
  selected,
  onExpandedChange,
  onOpen,
  onMenu,
}: {
  apps: AppItem[];
  language: Settings["language"];
  expanded: boolean;
  selected: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onOpen: (app: AppItem) => void;
  onMenu: (id: string, x: number, y: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const en = language === "en";
  const close = () => {
    onExpandedChange(false);
    root.current?.querySelector<HTMLButtonElement>(".pinned-stack-toggle")?.focus();
  };

  useEffect(() => {
    if (!expanded) return;
    panel.current?.querySelector<HTMLButtonElement>(".pinned-stack-app")?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onExpandedChange(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [expanded, onExpandedChange]);

  return (
    <div className="pinned-stack" ref={root}>
      <button
        type="button"
        className={`app-card compact pinned-stack-toggle ${selected ? "keyboard-selected" : ""}`}
        aria-selected={selected || undefined}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        aria-controls="pinned-apps-panel"
        aria-label={en ? `${expanded ? "Collapse" : "Expand"} ${apps.length} pinned apps` : `${expanded ? "收起" : "展开"} ${apps.length} 个收藏应用`}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span className="app-icon pinned-stack-preview" aria-hidden="true">
          {apps.slice(0, 3).reverse().map((app) => <AppGlyph key={app.id} app={app} />)}
          <span className="pinned-stack-count">{apps.length}</span>
        </span>
        <span className="app-meta"><strong>{en ? "Pinned apps" : "收藏置顶"}<ChevronDown size={11} /></strong></span>
      </button>
      {expanded && (
        <div
          id="pinned-apps-panel"
          ref={panel}
          className="pinned-stack-panel"
          role="dialog"
          aria-label={en ? "Pinned apps" : "收藏应用"}
          onWheel={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
            const appButtons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".pinned-stack-app"));
            if (event.key === "Tab") {
              event.preventDefault();
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[(current + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
              return;
            }
            const index = appButtons.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0) return;
            const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[event.key];
            if (delta === undefined) return;
            event.preventDefault();
            appButtons[Math.max(0, Math.min(appButtons.length - 1, index + delta))]?.focus();
          }}
        >
          <header>
            <strong>{en ? "Pinned apps" : "收藏置顶"}<small>{apps.length}</small></strong>
            <button type="button" onClick={close} aria-label={en ? "Collapse pinned apps" : "收起收藏应用"}><X size={15} /></button>
          </header>
          <div className="pinned-stack-apps">
            {apps.map((app) => (
              <button
                type="button"
                key={app.id}
                className="app-card compact pinned-stack-app"
                onClick={() => onOpen(app)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onMenu(app.id, event.clientX, event.clientY);
                }}
              >
                <AppGlyph app={app} />
                <span className="app-meta"><strong title={app.name}>{appDisplayName(app, language)}</strong></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
