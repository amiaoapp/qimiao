export type DesktopPlatform = "macos" | "windows" | "linux";
export type SystemAction = {
  id: string;
  zh: string;
  en: string;
  aliases: string;
  confirm?: boolean;
  platforms?: DesktopPlatform[];
};

export const systemActions: SystemAction[] = [
  { id: "shut-down", zh: "关机", en: "Shut Down", aliases: "关闭电脑 关闭计算机 电源 shutdown power off", confirm: true },
  { id: "restart", zh: "重新启动", en: "Restart", aliases: "重启 reboot restart", confirm: true },
  { id: "sleep", zh: "睡眠", en: "Sleep", aliases: "待机 挂起 sleep standby suspend", confirm: true },
  { id: "hibernate", zh: "休眠", en: "Hibernate", aliases: "深度休眠 hibernate hibernation", confirm: true, platforms: ["windows", "linux"] },
  { id: "sleep-displays", zh: "熄屏", en: "Turn Display Off", aliases: "息屏 黑屏 灭屏 关闭屏幕 关闭显示器 屏幕睡眠 display off monitor sleep" },
  { id: "lock", zh: "锁定屏幕", en: "Lock Screen", aliases: "锁屏 锁定 lock screen" },
  { id: "log-out", zh: "注销", en: "Log Out", aliases: "退出登录 logout log out sign out", confirm: true },
  { id: "show-screen-saver", zh: "启动屏幕保护", en: "Show Screen Saver", aliases: "屏保 屏幕保护 screen saver" },
  { id: "show-desktop", zh: "显示桌面", en: "Show Desktop", aliases: "桌面 desktop" },
  { id: "open-trash", zh: "打开废纸篓", en: "Open Trash", aliases: "垃圾桶 回收站 trash recycle bin" },
  { id: "empty-trash", zh: "清空废纸篓", en: "Empty Trash", aliases: "清空回收站 清空垃圾桶 empty trash", confirm: true },
  { id: "toggle-hidden-files", zh: "显示／隐藏文件", en: "Toggle Hidden Files", aliases: "隐藏文件 hidden files", platforms: ["macos", "windows"] },
  { id: "play-pause", zh: "播放／暂停", en: "Play / Pause", aliases: "播放 暂停 play pause" },
  { id: "next-track", zh: "下一曲", en: "Next Track", aliases: "下一首 next track" },
  { id: "previous-track", zh: "上一曲", en: "Previous Track", aliases: "上一首 previous track" },
  { id: "toggle-mute", zh: "静音切换", en: "Toggle Mute", aliases: "静音 mute" },
  { id: "volume-up", zh: "调高音量", en: "Volume Up", aliases: "音量增加 声音大 volume up" },
  { id: "volume-down", zh: "调低音量", en: "Volume Down", aliases: "音量减小 声音小 volume down" },
];

export const availableSystemActions = (platform: DesktopPlatform) =>
  systemActions.filter((action) => !action.platforms || action.platforms.includes(platform));

export const findSystemActions = (query: string, platform: DesktopPlatform) => {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return availableSystemActions(platform).filter((action) => {
    const text = `${action.zh} ${action.en} ${action.aliases}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
};
