import { useEffect, useRef, useState } from "react";
import { loadAppIcon } from "./tauri";
import type { AppItem } from "./types";
export default function AppGlyph({ app }: { app: AppItem }) {
  const [src, setSrc] = useState(
    app.icon?.startsWith("data:image/") ? app.icon : "",
  );
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let active = true,
      requested = false;
    const load = () => {
      if (requested) return;
      requested = true;
      void loadAppIcon(app.path, app.name)
        .then((value) => {
          if (active && value.startsWith("data:image/")) setSrc(value);
        })
        .catch(() => {});
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        load();
        observer.disconnect();
      }
    });
    if (!src && ref.current) observer.observe(ref.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [app.path, app.name, src]);
  return (
    <span className="result-app-glyph" ref={ref}>
      {src ? (
        <img src={src} alt="" />
      ) : (
        <span>{app.name[0]?.toUpperCase()}</span>
      )}
    </span>
  );
}
