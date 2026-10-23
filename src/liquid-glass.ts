// Rounded-rectangle displacement: the centre stays still; only the rim refracts.
export function refractionPixel(x: number, y: number, width: number, height: number, radius: number): [number, number, number, number] {
  const r = Math.min(radius, width / 2, height / 2);
  const px = x - width / 2, py = y - height / 2;
  const qx = Math.abs(px) - width / 2 + r, qy = Math.abs(py) - height / 2 + r;
  const cx = Math.max(qx, 0), cy = Math.max(qy, 0);
  const length = Math.hypot(cx, cy);
  const distance = length + Math.min(Math.max(qx, qy), 0) - r;
  const rim = Math.min(18, Math.min(width, height) / 3);
  const bend = Math.max(0, 1 - Math.max(0, -distance) / rim) ** 2;
  const nx = length ? Math.sign(px) * cx / length : qx > qy ? Math.sign(px) : 0;
  const ny = length ? Math.sign(py) * cy / length : qy >= qx ? Math.sign(py) : 0;
  return [Math.round(128 + nx * bend * 110), Math.round(128 + ny * bend * 110), 128, 255];
}
