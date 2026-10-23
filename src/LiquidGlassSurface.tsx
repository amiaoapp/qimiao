import { useEffect, useId, useRef } from "react";
import { refractionPixel } from "./liquid-glass";

// Background-only refraction adapted from rdev/liquid-glass-react (MIT).
// Native macOS glass remains responsible for desktop sampling on macOS.
export default function LiquidGlassSurface({ enabled, radius = 24 }: { enabled: boolean; radius?: number }) {
  const id = `qimiao-glass-${useId().replace(/:/g, "")}`;
  const surface = useRef<HTMLDivElement>(null);
  const map = useRef<SVGFEImageElement>(null);
  useEffect(() => {
    if (!enabled || !surface.current) return;
    const element = surface.current;
    const host = element.parentElement!;
    const chromium = /Chrome|Chromium|Edg\//.test(navigator.userAgent);
    let resizeFrame = 0, pointerFrame = 0;
    const renderMap = () => {
      cancelAnimationFrame(resizeFrame);
      if (!chromium) return;
      resizeFrame = requestAnimationFrame(() => {
        const { width, height } = element.getBoundingClientRect();
        if (width < 1 || height < 1) return;
        const scale = Math.min(1, 384 / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) return;
        const pixels = context.createImageData(canvas.width, canvas.height);
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            pixels.data.set(refractionPixel((x + .5) / scale, (y + .5) / scale, width, height, radius), (y * canvas.width + x) * 4);
          }
        }
        context.putImageData(pixels, 0, 0);
        map.current?.setAttribute("href", canvas.toDataURL());
        element.style.setProperty("--liquid-refraction", `url(#${id})`);
      });
    };
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = (event: PointerEvent) => {
      if (reducedMotion.matches || document.documentElement.dataset.motion === "reduced") return;
      cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        const bounds = host.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
        host.style.setProperty("--glass-light-angle", `${115 + x * 55}deg`);
      });
    };
    const reset = () => { cancelAnimationFrame(pointerFrame); host.style.removeProperty("--glass-light-angle"); };
    const observer = new ResizeObserver(renderMap);
    observer.observe(element);
    renderMap();
    host.addEventListener("pointermove", pointer, { passive: true });
    host.addEventListener("pointerleave", reset);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(pointerFrame);
      host.removeEventListener("pointermove", pointer);
      host.removeEventListener("pointerleave", reset);
      reset();
    };
  }, [enabled, id, radius]);
  if (!enabled) return null;
  return <div className="liquid-glass-surface" ref={surface} aria-hidden="true">
    <svg className="liquid-glass-defs" width="0" height="0" focusable="false">
      <defs>
        <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feImage ref={map} width="100%" height="100%" preserveAspectRatio="none" result="rim" />
          <feDisplacementMap in="SourceGraphic" in2="rim" scale="30" xChannelSelector="R" yChannelSelector="G" result="red" />
          <feColorMatrix in="red" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feDisplacementMap in="SourceGraphic" in2="rim" scale="29" xChannelSelector="R" yChannelSelector="G" result="green" />
          <feColorMatrix in="green" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feDisplacementMap in="SourceGraphic" in2="rim" scale="28" xChannelSelector="R" yChannelSelector="G" result="blue" />
          <feColorMatrix in="blue" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feBlend in="r" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="b" mode="screen" />
        </filter>
      </defs>
    </svg>
    <span className="liquid-glass-warp" />
    <span className="liquid-glass-tint" />
    <span className="liquid-glass-rim" />
  </div>;
}
