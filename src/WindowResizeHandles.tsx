const directions = ["North", "NorthEast", "East", "SouthEast", "South", "SouthWest", "West", "NorthWest"] as const;

export default function WindowResizeHandles() {
  return <div className="window-resize-handles" aria-hidden="true">
    {directions.map((direction) => <div key={direction} className={`window-resize-handle resize-${direction}`} onMouseDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (!("__TAURI_INTERNALS__" in window)) return;
      void import("@tauri-apps/api/core").then(({ invoke }) => invoke("start_tool_resize", { direction })).catch(console.warn);
    }} />)}
  </div>;
}
