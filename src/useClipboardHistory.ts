import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Settings } from "./types";
import {
  mergeClips,
  textClip,
  validateClips,
  type Clip,
} from "./clipboard-core";
import { clipboardCaptureBatch, configureClipboardCapture, loadClipHistory, saveClipHistory } from "./tauri";
import { acceptClipboardBatch } from "./clipboard-capture";
import { listen } from "@tauri-apps/api/event";

export function useClipboardHistory(settings: Settings) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [captureError, setCaptureError] = useState("");
  const error = storageError || captureError;
  const [notice, setNotice] = useState("");
  const [paused, setPaused] = useState(false);
  const options = settings.clipboardOptions;
  const latest = useRef(clips);
  latest.current = clips;
  const captureSettings = useRef({ settings, paused });
  captureSettings.current = { settings, paused };
  const captureControl = useRef(Promise.resolve());
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
          setStorageError("无法读取剪贴板数据库，未覆盖原文件。请重启后重试。");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void saveClipHistory(clips)
        .then(() => {
          localStorage.removeItem("qimiao-clipboard-history");
          setStorageError("");
        })
        .catch((error) => setStorageError(String(error)));
    }, 700);
    return () => clearTimeout(timer);
  }, [clips, ready]);
  useEffect(() => {
    if (!ready) return;
    let active = true,
      running = false;
    let configured = "", acknowledged = 0;
    const capture = async () => {
      if (running) return;
      running = true;
      try {
        const { settings, paused } = captureSettings.current;
        const enabled = settings.clipboardHistoryEnabled && !paused;
        const key = JSON.stringify([enabled, settings.clipboardOptions.ignoredApps]);
        if (configured !== key) {
          const configure = () => configureClipboardCapture(enabled, settings.clipboardOptions.ignoredApps);
          const pending = captureControl.current.then(configure, configure);
          captureControl.current = pending.catch(() => {});
          await pending;
          configured = key;
        }
        if (!active || !enabled) return;
        const batch = await clipboardCaptureBatch(acknowledged);
        if (!active) return; // Leave unreceived entries queued for the next consumer.
        const latestSettings = captureSettings.current;
        if (!latestSettings.settings.clipboardHistoryEnabled || latestSettings.paused) return;
        if (batch.entries.length) {
          const result = acceptClipboardBatch([], batch.entries, latestSettings.settings.clipboardOptions);
          setClips((current) => acceptClipboardBatch(current, batch.entries, latestSettings.settings.clipboardOptions).clips);
          const en = latestSettings.settings.language === "en";
          setNotice(result.skipped === "sensitive" ? (en ? "The latest copy was skipped by privacy rules. Check Privacy & storage." : "最近一次复制被疑似密码或密钥规则跳过，可在隐私与保留规则中检查。")
            : result.skipped === "ignored" ? (en ? "The latest copy came from an excluded app." : "最近一次复制来自排除的应用，未记录。")
            : result.skipped === "invalid" ? (en ? "The latest copy could not be saved because its format or size is unsupported." : "最近一次复制的格式或大小超出记录范围，未能保存。")
            : batch.notice ?? "");
          // Acknowledge on the next request, after scheduling the complete batch.
          acknowledged = batch.cursor;
        } else if (batch.notice) setNotice(batch.notice);
        setCaptureError(batch.error || (batch.dropped ? (latestSettings.settings.language === "en"
          ? `${batch.dropped} copies exceeded the clipboard buffer limit and could not be kept.`
          : `有 ${batch.dropped} 条复制超出后台暂存上限，未能保留。`) : ""));
      } catch (error) {
        if (active) setCaptureError(String(error));
      } finally {
        running = false;
      }
    };
    let unlisten: (() => void) | undefined;
    if ("__TAURI_INTERNALS__" in window) {
      void listen("clipboard-capture-ready", () => { void capture(); }).then((stop) => {
        if (active) unlisten = stop; else stop();
      }).catch((error) => { if (active) setCaptureError(String(error)); });
    }
    void capture();
    const timer = setInterval(capture, 100);
    return () => {
      active = false;
      clearInterval(timer);
      unlisten?.();
      const stop = () => configureClipboardCapture(false, []);
      captureControl.current = captureControl.current.then(stop, stop).catch(() => {});
    };
  }, [ready]);
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
    notice,
    ready,
    latest,
  };
}
