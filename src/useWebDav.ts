import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  clipsForSync,
  prepareClipboardSync,
  mergeClips,
  validateClips,
  type Clip,
} from "./clipboard-core";
import {
  connectDav,
  forgetDav,
  readDav,
  syncDavImage,
  writeDav,
} from "./tauri";
import { readPortableConfiguration, type PortableConfig } from "./sync-core";
import type { Settings } from "./types";

export function useWebDav(
  settings: Settings,
  clips: Clip[],
  setClips: Dispatch<SetStateAction<Clip[]>>,
  ready: boolean,
  configuration: () => PortableConfig,
) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [lastSync, setLastSync] = useState("");
  const lock = useRef(false);
  const latest = useRef({ settings, clips, configuration });
  latest.current = { settings, clips, configuration };
  const run = useCallback(async (task: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setStatus("");
    try {
      await task();
      setStatus(
        latest.current.settings.language === "en" ? "Completed" : "操作完成",
      );
    } catch (error) {
      setStatus(String(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  const syncClipboard = useCallback(
    () =>
      run(async () => {
        const { settings: s, clips: current } = latest.current;
        if (!s.webdav.clipboardEnabled || !ready)
          throw new Error("请先开启剪贴板同步 / Enable clipboard sync first");
        const remote = await readDav(s.webdav, "clipboard");
        let incoming: Clip[] = [];
        if (remote) {
          const payload = JSON.parse(remote.data);
          if (
            payload?.format !== "qimiao-clipboard" ||
            payload.version !== 1 ||
            !Array.isArray(payload.entries)
          )
            throw new Error(
              "远端剪贴板格式不兼容，未覆盖 / Incompatible remote history",
            );
          incoming = clipsForSync(validateClips(payload.entries), true);
        }
        const { merged, outgoing } = prepareClipboardSync(
          current,
          incoming,
          s.clipboardOptions,
          s.webdav.syncImages,
        );
        const remoteImages = new Set(
          incoming.filter((c) => !c.deletedAt).map((c) => c.imageKey),
        );
        for (const key of new Set(
          outgoing
            .filter(
              (c) =>
                !c.deletedAt && c.imageKey && !remoteImages.has(c.imageKey),
            )
            .map((c) => c.imageKey!),
        )) {
          setStatus(
            s.language === "en" ? "Uploading images…" : "正在上传图片…",
          );
          await syncDavImage(s.webdav, key, true);
        }
        await writeDav(
          s.webdav,
          "clipboard",
          JSON.stringify({
            format: "qimiao-clipboard",
            version: 1,
            entries: outgoing,
          }),
          remote,
        );
        // Merge again with the latest state: edits and copies made during the request win.
        setClips((current) => mergeClips(current, merged, s.clipboardOptions));
        setLastSync(new Date().toLocaleString());
      }),
    [run, ready, setClips],
  );
  useEffect(() => {
    if (
      !ready ||
      !settings.webdav.clipboardEnabled ||
      !settings.webdav.autoClipboard ||
      !settings.webdav.url
    )
      return;
    const timer = setInterval(
      () => {
        void syncClipboard();
      },
      Math.max(5, Math.min(120, settings.webdav.intervalMinutes)) * 60000,
    );
    return () => clearInterval(timer);
  }, [
    ready,
    settings.webdav.clipboardEnabled,
    settings.webdav.autoClipboard,
    settings.webdav.url,
    settings.webdav.intervalMinutes,
    syncClipboard,
  ]);
  return {
    busy,
    status,
    lastSync,
    syncClipboard,
    connect: (password: string) =>
      run(() => connectDav(latest.current.settings.webdav, password)),
    forget: () => run(() => forgetDav(latest.current.settings.webdav)),
    uploadConfiguration: () =>
      run(async () => {
        const { settings: s, configuration } = latest.current;
        if (!s.webdav.configurationEnabled)
          throw new Error("请先开启配置同步 / Enable configuration sync first");
        const remote = await readDav(s.webdav, "configuration");
        await writeDav(
          s.webdav,
          "configuration",
          JSON.stringify(configuration()),
          remote,
        );
        setLastSync(new Date().toLocaleString());
      }),
    downloadConfiguration: (receive: (config: PortableConfig) => void) =>
      run(async () => {
        const s = latest.current.settings;
        if (!s.webdav.configurationEnabled)
          throw new Error("请先开启配置同步 / Enable configuration sync first");
        const remote = await readDav(s.webdav, "configuration");
        if (!remote)
          throw new Error("远端还没有配置 / No remote configuration yet");
        receive(readPortableConfiguration(remote.data));
      }),
  };
}
export type WebDavController = ReturnType<typeof useWebDav>;
