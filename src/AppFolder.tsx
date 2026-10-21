import { useEffect, useRef, useState } from "react";
import { Check, FolderMinus, X } from "lucide-react";
import AppGlyph from "./AppGlyph";
import { appDisplayName } from "./app-catalog";
import type { AppItem, Settings } from "./types";
import "./app-folder.css";

export function FolderCard({ apps, name, selected, onOpen, onGroup }: {
  apps: AppItem[]; name: string; selected: boolean;
  onOpen: () => void; onGroup: (source: string, target: string) => void;
}) {
  return <button className={`app-card folder-card ${selected ? "keyboard-selected" : ""}`} draggable aria-selected={selected || undefined} aria-haspopup="dialog" onClick={onOpen}
    onContextMenu={(event) => { event.preventDefault(); onOpen(); }}
    onDragStart={(event) => { event.dataTransfer.setData("text/miaoqi-app", apps[0].id); event.dataTransfer.effectAllowed = "move"; }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("text/miaoqi-app")) { event.preventDefault(); event.currentTarget.classList.add("drop-target"); } }}
    onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")}
    onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("drop-target"); onGroup(event.dataTransfer.getData("text/miaoqi-app"), apps[0].id); }}>
    <span className="app-icon folder-preview">{apps.slice(0, 4).map((app) => <AppGlyph key={app.id} app={app} />)}</span>
    <span className="app-meta"><strong title={name}>{name}</strong><span>{apps.length}</span></span>
  </button>;
}

export function AppFolderDialog({ apps, language, onClose, onRename, onOpen, onRemove }: {
  apps: AppItem[]; language: Settings["language"];
  onClose: () => void; onRename: (name: string) => void;
  onOpen: (app: AppItem) => void; onRemove: (id: string) => void;
}) {
  const en = language === "en";
  const [name, setName] = useState(apps[0].folder!.name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus(); input.current?.select();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-shade" data-local-dialog onClick={onClose}>
    <section className="clip-dialog app-folder-dialog" role="dialog" aria-modal="true" aria-label={apps[0].folder!.name} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if ((event.target as HTMLElement).closest(".folder-member-open")) {
          const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[event.key];
          if (delta !== undefined) {
            event.preventDefault();
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".folder-member-open"));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))]?.focus();
            return;
          }
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input"));
        const index = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length]?.focus();
      }}>
      <button className="clip-close" onClick={onClose} aria-label={en ? "Collapse group" : "收起分组"}><X /></button>
      <form className="folder-name" onSubmit={(event) => { event.preventDefault(); onRename(name); }}>
        <input ref={input} aria-label={en ? "Group name" : "分组名称"} value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
        <button className="secondary" disabled={!name.trim() || name.trim() === apps[0].folder!.name} title={en ? "Save group name" : "保存分组名称"}><Check size={16} /></button>
      </form>
      <p>{en ? `${apps.length} apps · Edit the name above to rename this group` : `${apps.length} 个应用 · 修改上方名称即可重命名分组`}</p>
      <div className="folder-members">
        {apps.map((app) => <div className="folder-member" key={app.id}>
          <button className="folder-member-open" onClick={() => onOpen(app)}><AppGlyph app={app} /><span>{appDisplayName(app, language)}</span></button>
          <button className="folder-member-remove" title={en ? "Move out of group" : "移出分组"} aria-label={`${en ? "Move out" : "移出分组"} ${app.name}`} onClick={() => onRemove(app.id)}><FolderMinus size={14} /></button>
        </div>)}
      </div>
    </section>
  </div>;
}
