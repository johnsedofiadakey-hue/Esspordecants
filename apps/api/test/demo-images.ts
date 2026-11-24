import zlib from "node:zlib";

// Draws a simple perfume-bottle picture so local demo products look like a real shop.
// Local development only: these are not product photos and are never used in production.
export function bottlePng(hue: number, variant: "front" | "side" = "front", width = 640, height = 800): Buffer {
  const hsl = (h: number, s: number, l: number): [number, number, number] => {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  };
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t));
  const top = hsl(hue, 0.35, 0.9);
  const bottom = hsl((hue + 20) % 360, 0.3, 0.78);
  const liquid = hsl(hue, 0.75, 0.5);
  const liquidLight = hsl(hue, 0.7, 0.66);
  const glass = [255, 255, 255];
  const cap = hsl((hue + 200) % 360, 0.15, 0.16);
  const cx = variant === "front" ? width / 2 : width / 2 + 40;
  const bodyW = variant === "front" ? 250 : 190;
  const bodyTop = 330;
  const bodyBottom = 690;
  const radius = 34;

  const inRoundRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return dx * dx + dy * dy <= r * r;
  };

  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      let color = mix(top, bottom, y / height);
      // Soft floor shadow.
      const sx = (x - cx) / (bodyW * 0.75);
      const sy = (y - (bodyBottom + 14)) / 22;
      if (sx * sx + sy * sy < 1) color = mix(color, [40, 25, 15], 0.28 * (1 - (sx * sx + sy * sy)));
      // Cap, neck, body.
      if (inRoundRect(x, y, cx - 52, 150, cx + 52, 262, 14)) color = mix(cap, [255, 255, 255], x > cx - 38 && x < cx - 28 ? 0.25 : 0);
      else if (inRoundRect(x, y, cx - 24, 258, cx + 24, bodyTop + 10, 4)) color = mix(glass, liquidLight, 0.35);
      else if (inRoundRect(x, y, cx - bodyW / 2, bodyTop, cx + bodyW / 2, bodyBottom, radius)) {
        const t = (x - (cx - bodyW / 2)) / bodyW;
        const filled = y > bodyTop + 70;
        const base = filled ? mix(liquidLight, liquid, Math.min(1, (y - bodyTop) / 320)) : mix(glass, bottom, 0.1);
        color = mix(base, [255, 255, 255], t > 0.12 && t < 0.2 ? 0.45 : 0);
        if (t > 0.86) color = mix(color, [0, 0, 0], 0.12);
        // A label panel on the front view.
        if (variant === "front" && y > 470 && y < 600 && t > 0.18 && t < 0.82) color = [252, 246, 236];
      }
      const i = row + 1 + x * 3;
      raw[i] = color[0]!;
      raw[i + 1] = color[1]!;
      raw[i + 2] = color[2]!;
    }
  }

  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
