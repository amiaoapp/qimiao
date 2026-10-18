import { useState } from "react";
import {
  Cloud,
  RefreshCw,
  Download,
  Upload,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Settings } from "./types";
import type { WebDavController } from "./useWebDav";
import type { PortableConfig } from "./sync-core";

export default function WebDavPanel({
  settings,
  update,
  controller,
  applyConfiguration,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  controller: WebDavController;
  applyConfiguration: (p: PortableConfig) => void;
}) {
  const en = settings.language === "en",
    dav = settings.webdav;
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<PortableConfig | "upload" | null>(
    null,
  );
  const change = (p: Partial<typeof dav>) =>
    update({ webdav: { ...dav, ...p } });
  const toggle = (
    key:
      | "clipboardEnabled"
      | "configurationEnabled"
      | "autoClipboard"
      | "syncImages"
      | "remember"
      | "allowInsecure",
    zh: string,
    english: string,
  ) => (
    <label className="clip-check">
      <input
        type="checkbox"
        checked={dav[key]}
        onChange={(e) => change({ [key]: e.target.checked })}
      />
      <span>{en ? english : zh}</span>
    </label>
  );
  return (
    <section className="sync-panel setting-section">
      <h2>
        <Cloud size={20} />
        {en ? "WebDAV sync" : "WebDAV 同步"}
      </h2>
      <p className="clip-muted">
        {en
          ? "Your own server. Clipboard and launcher configuration sync independently."
          : "使用你自己的服务器。剪贴板与启动器配置可以分别开启同步。"}
      </p>
      <div className="dav-form">
        <label>
          {en ? "Folder URL" : "文件夹地址"}
          <input
            type="url"
            placeholder="https://dav.example.com/backup/"
            autoComplete="off"
            value={dav.url}
            onChange={(e) => change({ url: e.target.value })}
          />
        </label>
        <label>
          {en ? "Username" : "用户名"}
          <input
            autoComplete="off"
            value={dav.username}
            onChange={(e) => change({ username: e.target.value })}
          />
        </label>
        <label>
          {en ? "Password / app password" : "密码 / 应用专用密码"}
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              en
                ? "Leave blank to use saved credentials"
                : "留空使用系统密钥库中的密码"
            }
          />
        </label>
      </div>
      <div className="clip-checks">
        {toggle(
          "remember",
          "在系统密钥库记住密码",
          "Remember in system credential store",
        )}
        {toggle(
          "allowInsecure",
          "允许不安全的 HTTP（密码与内容可能被窃取）",
          "Allow insecure HTTP (credentials and data may be intercepted)",
        )}
      </div>
      <div className="clip-actions">
        <button
          className="secondary"
          disabled={controller.busy || !dav.url}
          onClick={() => {
            const secret = password;
            setPassword("");
            void controller.connect(secret);
          }}
        >
          <ShieldCheck size={16} />
          {en ? "Connect & test" : "连接并测试"}
        </button>
        <button
          className="secondary"
          disabled={controller.busy}
          onClick={() => void controller.forget()}
        >
          {en ? "Forget credentials" : "清除已存密码"}
        </button>
      </div>
      <div className="dav-section">
        {toggle("clipboardEnabled", "同步剪贴板历史", "Sync clipboard history")}
        <p className="clip-muted">
          {en
            ? "Merges edits and deletions. Sensitive items, rich HTML and file paths are never uploaded. Images are optional."
            : "合并记录、编辑和删除。敏感条目、富文本 HTML 和文件路径不上传，图片可单独关闭。"}
        </p>
        <div className="clip-checks">
          {toggle("syncImages", "包含图片原图", "Include original images")}
          {toggle("autoClipboard", "定期自动同步", "Sync periodically")}
          <label>
            {en ? "Interval" : "间隔"}
            <select
              value={dav.intervalMinutes}
              onChange={(e) =>
                change({ intervalMinutes: Number(e.target.value) })
              }
            >
              {[5, 15, 30, 60, 120].map((n) => (
                <option key={n} value={n}>
                  {n} {en ? "min" : "分钟"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="secondary"
          disabled={controller.busy || !dav.clipboardEnabled}
          onClick={() => void controller.syncClipboard()}
        >
          <RefreshCw size={16} />
          {en ? "Sync history now" : "立即同步剪贴板"}
        </button>
      </div>
      <div className="dav-section">
        {toggle(
          "configurationEnabled",
          "同步软件配置",
          "Sync launcher configuration",
        )}
        <p className="clip-muted">
          {en
            ? "Categories, app assignments, pins and appearance. Matches local apps by name; missing apps keep their assignments for later. No API keys, commands or device settings."
            : "同步分类、应用归属、收藏与外观。按名称匹配本机应用，未安装的保留归属待添加。不包含 API Key、可执行命令和设备专属设置。"}
        </p>
        <div className="clip-actions">
          <button
            className="secondary"
            disabled={controller.busy || !dav.configurationEnabled}
            onClick={() => setPending("upload")}
          >
            <Upload size={16} />
            {en ? "Upload configuration" : "上传本机配置"}
          </button>
          <button
            className="secondary"
            disabled={controller.busy || !dav.configurationEnabled}
            onClick={() => void controller.downloadConfiguration(setPending)}
          >
            <Download size={16} />
            {en ? "Restore from server" : "从云端恢复"}
          </button>
        </div>
      </div>
      <p className="clip-muted">
        {en
          ? "HTTPS encrypts transport, not the files on your server. Use a trusted server. Automatic sync begins after the selected interval."
          : "HTTPS 仅加密传输，服务器文件不是端到端加密。请使用可信服务器。自动同步将在所选间隔后开始。"}
      </p>
      <div role="status" className="sync-status">
        {controller.busy ? (en ? "Working… " : "处理中… ") : ""}
        {controller.status}
        {controller.lastSync && (
          <small>
            {en ? "Last sync: " : "上次同步："}
            {controller.lastSync}
          </small>
        )}
      </div>
      {pending && (
        <div
          className="modal-shade"
          data-local-dialog
          onClick={() => setPending(null)}
        >
          <section
            className="clip-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="clip-close"
              aria-label={en ? "Close" : "关闭"}
              onClick={() => setPending(null)}
            >
              <X />
            </button>
            <h2 id="sync-confirm">
              {pending === "upload"
                ? en
                  ? "Replace remote configuration?"
                  : "替换云端配置？"
                : en
                  ? "Restore this configuration?"
                  : "恢复此配置？"}
            </h2>
            <p>
              {pending === "upload"
                ? en
                  ? "The current launcher preferences will replace the remote file. Clipboard history is separate."
                  : "本机分类、收藏和外观将替换远端配置文件。剪贴板历史不受影响。"
                : en
                  ? `${pending.settings.categories?.length ?? 0} categories and ${pending.apps.length} app assignments. Your credentials and device settings stay unchanged.`
                  : `${pending.settings.categories?.length ?? 0} 个分类，${pending.apps.length} 条应用归属。本机密码、快捷键和开机启动保持不变。`}
            </p>
            <div className="clip-actions">
              <button className="secondary" onClick={() => setPending(null)}>
                {en ? "Cancel" : "取消"}
              </button>
              <button
                className="primary"
                autoFocus
                onClick={() => {
                  if (pending === "upload")
                    void controller.uploadConfiguration();
                  else applyConfiguration(pending);
                  setPending(null);
                }}
              >
                {en ? "Confirm" : "确认"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
