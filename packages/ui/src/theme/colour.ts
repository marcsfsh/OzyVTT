/* Colour arithmetic for the theme checks: WCAG contrast between two inks, and the CIELAB distance that says
   whether two accents still look like different colours. */

export type Rgb = readonly [number, number, number];

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` / `rgba(r, g, b, a)` as 0-255 channels, or null for anything else. */
export function parseColour(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as unknown as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

export type Rgba = readonly [number, number, number, number];

/** As `parseColour`, keeping the alpha (1 when the colour gives none), so glass can be composited. */
export function parseColourAlpha(value: string): Rgba | null {
  const rgb = parseColour(value);
  if (!rgb) return null;
  const alpha = /^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+\s*[,/]\s*([\d.]+)(%?)/.exec(value.trim().toLowerCase());
  const a = alpha ? Number(alpha[1]) / (alpha[2] ? 100 : 1) : 1;
  return [rgb[0], rgb[1], rgb[2], a];
}

/** `top` painted over an opaque `bottom` (source-over in sRGB, as a browser composites). */
export function composite(top: Rgba, bottom: Rgb): Rgb {
  const a = top[3];
  return [0, 1, 2].map((at) => top[at] * a + bottom[at] * (1 - a)) as unknown as Rgb;
}

const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** CIELAB (D65) coordinates. */
export function lab([r, g, b]: Rgb): readonly [number, number, number] {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** How far apart two colours look (CIE76). Under about 10 reads as one colour; the accents stay far above it. */
export function colourDistance(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
