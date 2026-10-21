type RecordedKey = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function recordedHotkey(event: RecordedKey, mac: boolean): string | null {
  if (["Control", "Meta", "Alt", "Shift", "AltGraph"].includes(event.key)) return null;
  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push(mac ? "Command" : "Super");
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.length) return null;
  // Physical codes also preserve punctuation and Option-modified keys on macOS.
  const key = event.code && event.code !== "Unidentified" ? event.code : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join("+");
}

export function hotkeyLabel(value: string, mac: boolean): string {
  const labels: Record<string, string> = { CommandOrControl: mac ? "⌘" : "Ctrl", Command: "⌘", Control: "Ctrl", Super: mac ? "⌘" : "Win", Alt: mac ? "⌥" : "Alt", Shift: "⇧", Backquote: "`", Equal: "=", Minus: "-", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/" };
  return value.split("+").map((part) => labels[part] ?? part.replace(/^Key(?=[A-Z]$)|^Digit(?=\d$)/, "")).join("  +  ");
}
