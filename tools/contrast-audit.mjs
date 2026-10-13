/** Offline sRGB contrast math. Inputs require independently established opaque backgrounds.
 * Not a DOM audit: opacity/group effects, gradients and unknown ancestors must remain unknown.
 */
const clamp = (x) => Math.max(0, Math.min(1, x));
const linear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const encoded = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const matrix = (m, v) => m.map((row) => row.reduce((n, x, i) => n + x * v[i], 0));
const xyzRgb = [
  [3.2409699419, -1.5373831776, -0.4986107603],
  [-0.9692436363, 1.8759675015, 0.0415550574],
  [0.0556300797, -0.2039769589, 1.0569715142],
];
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const hex = /^#([\da-f]{6})$/i.exec(input);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255);
  const match = /^(oklch|lab)\(([\d.+-]+)(%)?\s+([\d.+-]+)\s+([\d.+-]+)\)$/.exec(input);
  if (!match) return null;
  let L = Number(match[2]),
    a = Number(match[4]),
    b = Number(match[5]);
  if (![L, a, b].every(Number.isFinite)) return null;
  let rgb;
  if (match[1] === 'oklch') {
    if (match[3]) L /= 100;
    if (L < 0 || L > 1 || a < 0) return null;
    const angle = (b * Math.PI) / 180;
    [a, b] = [a * Math.cos(angle), a * Math.sin(angle)];
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
      m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
      s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    rgb = matrix(
      [
        [4.0767416621, -3.3077115913, 0.2309699292],
        [-1.2684380046, 2.6097574011, -0.3413193965],
        [-0.0041960863, -0.7034186147, 1.707614701],
      ],
      [l, m, s],
    );
  } else {
    // CSS Lab is D50. Bradford-adapt XYZ to D65 before linear sRGB.
    if (L < 0 || L > 100) return null;
    const f = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
    const y = (L + 16) / 116;
    const xyz = [0.9642956764 * f(y + a / 500), f(y), 0.8251046025 * f(y - b / 200)];
    rgb = matrix(
      xyzRgb,
      matrix(
        [
          [0.9554734215, -0.0230984549, 0.0632592432],
          [-0.0283697093, 1.0099953981, 0.0210414412],
          [0.0123140149, -0.0205076493, 1.3303659262],
        ],
        xyz,
      ),
    );
  }
  // Explicit clipping into sRGB; not a claim of browser perceptual gamut mapping.
  return rgb.map((x) => encoded(clamp(x)));
}
export function contrast(foreground, background, opacity = 1) {
  const fg = parseColor(foreground),
    bg = parseColor(background);
  if (!fg || !bg || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) return { status: 'unknown' };
  const effective = fg.map((x, i) => x * opacity + bg[i] * (1 - opacity));
  const luminance = (rgb) => rgb.map(linear).reduce((n, x, i) => n + x * [0.2126, 0.7152, 0.0722][i], 0);
  const a = luminance(effective),
    b = luminance(bg),
    ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return { status: 'calculated', ratio, normalPass: ratio >= 4.5, largePass: ratio >= 3, srgb: effective, backgroundSrgb: bg };
}
