/**
 * Brand green as sRGB hex, mirroring the `--color-brand-*` tokens in
 * app/globals.css (test/brand.test.ts keeps them equal). Canvas charts and
 * generated SVG cannot read Tailwind classes, so they take colours from here.
 */
export const brand = {
  50: '#f0fdf4',
  100: '#dcfce7',
  200: '#bbf7d0',
  300: '#86efac',
  400: '#4ade80',
  500: '#22c55e',
  600: '#16a34a',
  700: '#15803d',
  800: '#166534',
  900: '#14532d',
  950: '#052e16',
} as const;

/** Chart marks (bars, nodes): brand-600 on light, brand-400 on dark; both clear 3:1 against the chart background. */
export function brandMark(dark: boolean): string {
  return dark ? brand[400] : brand[600];
}

/** WCAG 2.x relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG 2.x contrast ratio between two #rrggbb colours (1–21). */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
