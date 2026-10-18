import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Settings } from "./types";
import {
  applyClipRules,
  detectClipKind,
  isSensitiveClip,
  mergeClips,
  textClip,
  validateClips,
  type Clip,
} from "./clipboard-core";
import { clipboardSnapshot, loadClipHistory, saveClipHistory } from "./tauri";

export function useClipboardHistory(settings: Settings) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const options = settings.clipboardOptions;
  const latest = useRef(clips);
  latest.current = clips;
  useEffect(() => {
    let active = true;
    void loadClipHistory()
      .then((value) => {
        if (!active) return;
        let entries = validateClips(value);
        if (!entries.length) {
          try {
            entries = (
              JSON.parse(
                localStorage.getItem("qimiao-clipboard-history") ?? "[]",
              ) as unknown[]
            )
              .filter((item): item is string => typeof item === "string")
              .map((text) => textClip(text));
          } catch {
            /* No legacy history */
          }
        }
        setClips(mergeClips(entries, [], options));
        setReady(true);
      })
      .catch(() => {
        if (active)
          setError("无法读取剪贴板数据库，未覆盖原文件。请重启后重试。");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void saveClipHistory(clips)
        .then(() => localStorage.removeItem("qimiao-clipboard-history"))
        .catch((error) => setError(String(error)));
    }, 700);
    return () => clearTimeout(timer);
  }, [clips, ready]);
  useEffect(() => {
    if (!ready || !settings.clipboardHistoryEnabled || paused) return;
    let active = true,
      running = false;
    const capture = async () => {
      if (running) return;
      running = true;
      try {
        const raw = await clipboardSnapshot(options.ignoredApps);
        if (!active || !raw) return;
        const source =
          `${raw.sourceApp ?? ""} ${raw.sourceId ?? ""}`.toLowerCase();
        if (
          options.ignoredApps.some(
            (app) => app.trim() && source.includes(app.trim().toLowerCase()),
          )
        )
          return;
        const sensitive =
          isSensitiveClip(raw.text, source) ||
          Boolean(raw.html && isSensitiveClip(raw.html));
        if (sensitive && options.skipSensitive) return;
        const text = applyClipRules(raw.text, options.rules);
        const next = {
          ...raw,
          text,
          kind: raw.kind === "text" ? detectClipKind(text) : raw.kind,
          sensitive,
        };
        setClips((current) => {
          const previous = current.find(
            (clip) =>
              clip.id === next.id ||
              (!clip.deletedAt &&
                clip.kind === next.kind &&
                clip.text === next.text &&
                clip.imageKey === next.imageKey &&
                JSON.stringify(clip.files) === JSON.stringify(next.files)),
          );
          const entry = previous
            ? {
                ...next,
                id: previous.id,
                createdAt: previous.createdAt,
                pinned: previous.pinned,
                favorite: previous.favorite,
                group: previous.group,
                title: previous.title,
                updatedAt: Date.now(),
                deletedAt: undefined,
                lastUsedAt: Date.now(),
              }
            : next;
          return mergeClips(current, [entry], options);
        });
        setError("");
      } catch (error) {
        if (active) setError(String(error));
      } finally {
        running = false;
      }
    };
    void capture();
    const timer = setInterval(capture, 900);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, settings.clipboardHistoryEnabled, paused, options]);
  useEffect(() => {
    if (ready) setClips((current) => mergeClips(current, [], options));
  }, [options.maxItems, options.retentionDays, ready]);
  const importTexts = useCallback(
    (texts: string[]) => {
      setClips((current) =>
        mergeClips(
          current,
          texts
            .filter(
              (text) =>
                text.trim() &&
                !current.some((clip) => !clip.deletedAt && clip.text === text),
            )
            .map((text) => textClip(text)),
          options,
        ),
      );
    },
    [options],
  );
  const textEntries = useMemo(
    () =>
      clips
        .filter((clip) => !clip.deletedAt && clip.text)
        .map((clip) => clip.text),
    [clips],
  );
  return {
    clips,
    setClips,
    textEntries,
    importTexts,
    paused,
    setPaused,
    error,
    ready,
    latest,
  };
}
