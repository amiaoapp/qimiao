import { useEffect, useRef, useState, type SetStateAction } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { mergeClips, validateClips, type Clip } from "./clipboard-core";
import { normalizeSettings } from "./sync-core";
import type { Settings } from "./types";
import type { useClipboardHistory } from "./useClipboardHistory";
import { clipboardEdits } from "./clipboard-window-state";

type History = ReturnType<typeof useClipboardHistory>;
type ClipboardState = Pick<History, "clips" | "paused" | "error" | "notice" | "ready"> & { settings: Settings };
type ClipboardEdit = { clips?: Clip[]; deleted?: string[]; paused?: boolean; settings?: Partial<Settings> };
const desktop = () => "__TAURI_INTERNALS__" in window;

/** The launcher owns history, sync and disk writes; native code captures independently. */
export function useClipboardHost(settings: Settings, history: History, update: (p: Partial<Settings>) => void) {
  const latest = useRef({ settings, history, update });
  latest.current = { settings, history, update };
  const publish = () => {
    const { settings, history } = latest.current;
    return emitTo("clipboard", "clipboard-state", { settings, clips: history.clips, paused: history.paused, error: history.error, notice: history.notice, ready: history.ready });
  };
  useEffect(() => {
    if (!desktop()) return;
    let disposed = false;
    const disposers: (() => void)[] = [];
    const pending: ClipboardEdit[] = [];
    const apply = (edit: ClipboardEdit) => {
      const { history, settings, update } = latest.current;
      if (!history.ready) { pending.push(edit); return; }
      if (edit.clips || edit.deleted?.length) history.setClips((current) => {
        const retained = edit.deleted?.length ? current.filter((clip) => !edit.deleted!.includes(clip.id)) : current;
        return edit.clips?.length
          ? mergeClips(retained, validateClips(edit.clips), settings.clipboardOptions)
          : retained;
      });
      if (typeof edit.paused === "boolean") history.setPaused(edit.paused);
      if (edit.settings) update(edit.settings);
    };
    void (async () => {
      for (const [name, handler] of [
        ["clipboard-request", () => { void publish(); }],
        ["clipboard-edit", (event: { payload: ClipboardEdit }) => apply(event.payload)],
      ] as const) {
        const unlisten = await listen<ClipboardEdit>(name, handler);
        if (disposed) unlisten(); else disposers.push(unlisten);
      }
    })().catch(console.error);
    const flush = () => {
      if (!latest.current.history.ready || !pending.length) return;
      pending.splice(0).forEach(apply);
    };
    const timer = window.setInterval(flush, 25);
    return () => { disposed = true; window.clearInterval(timer); disposers.forEach((fn) => fn()); };
  }, []);
  useEffect(() => {
    if (desktop()) void publish().catch(console.warn);
  }, [settings, history.clips, history.paused, history.error, history.notice, history.ready]);
}

export function useClipboardClient(initialSettings: Settings, showError: (s: string) => void) {
  const [state, setState] = useState<ClipboardState>({ settings: initialSettings, clips: [], paused: false, error: "", notice: "", ready: false });
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (!desktop()) {
      try {
        const clips = validateClips(JSON.parse(localStorage.getItem("qimiao-clips-v2") ?? "[]"));
        setState((state) => ({ ...state, clips, ready: true }));
      } catch { setState((state) => ({ ...state, ready: true })); }
      return;
    }
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<ClipboardState>("clipboard-state", ({ payload }) => {
      if (!disposed) setState({ ...payload, settings: normalizeSettings(payload.settings) });
    }).then((unlisten) => {
      if (disposed) { unlisten(); return; }
      stop = unlisten;
      return emitTo("main", "clipboard-request", {});
    }).catch((error) => showError(String(error)));
    return () => { disposed = true; stop?.(); };
  }, []);
  function send(edit: ClipboardEdit) {
    if (desktop()) void emitTo("main", "clipboard-edit", edit).catch((error) => showError(String(error)));
  }
  return {
    ...state,
    setClips(action: SetStateAction<Clip[]>) {
      const before = latest.current.clips;
      const after = typeof action === "function" ? action(before) : action;
      latest.current = { ...latest.current, clips: after };
      setState(latest.current);
      const edits = clipboardEdits(before, after);
      send({ clips: edits.changed, deleted: edits.deleted });
      if (!desktop()) localStorage.setItem("qimiao-clips-v2", JSON.stringify(after));
    },
    setPaused(paused: boolean) {
      setState((state) => ({ ...state, paused }));
      send({ paused });
    },
    update(settings: Partial<Settings>) {
      setState((state) => ({ ...state, settings: normalizeSettings({ ...state.settings, ...settings }) }));
      send({ settings });
    },
  };
}
