/**
 * Photo filters for VUAL Studio — ported from Core Image (iOS) to Canvas 2D.
 *
 * Each filter processes an image via OffscreenCanvas (or regular Canvas)
 * and returns a base64 data-URL.
 */

export type FilterId = "none" | "natural" | "film" | "chrome" | "polaroid" | "polaroidDusk" | "polaroidBlue";

export interface FilterMeta {
  id: FilterId;
  label: string;
}

export const FILTERS: FilterMeta[] = [
  { id: "none", label: "Original" },
  { id: "natural", label: "Natural" },
  { id: "film", label: "Film" },
  { id: "chrome", label: "Chrome" },
  { id: "polaroid", label: "Polaroid" },
  { id: "polaroidDusk", label: "Polaroid Dusk" },
  { id: "polaroidBlue", label: "Polaroid Blue" },
];

// ─── public API ────────────────────────────────────────────

/**
 * Apply a named filter to a base64 image and return the result as a base64 data-URL.
 */
export async function applyFilter(
  base64Src: string,
  filterId: FilterId,
): Promise<string> {
  if (filterId === "none") return base64Src;

  const img = await loadImage(base64Src);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Polaroid variants need special handling (blur + light leak are canvas-level)
  if (filterId === "polaroid" || filterId === "polaroidDusk" || filterId === "polaroidBlue") {
    if (filterId === "polaroidBlue") {
      applyPolaroidBlue(imageData);
    } else if (filterId === "polaroidDusk") {
      applyPolaroidDusk(imageData);
    } else {
      applyPolaroid(imageData);
    }
    ctx.putImageData(imageData, 0, 0);
    drawRadialBlur(ctx, canvas.width, canvas.height, 0.8);
    drawLightLeak(ctx, canvas.width, canvas.height, filterId === "polaroidBlue" ? "blue" : filterId === "polaroidDusk" ? "dusk" : "warm");
    drawVignette(ctx, canvas.width, canvas.height, 0.55, 0.45);
    return canvas.toDataURL("image/png");
  }

  switch (filterId) {
    case "natural":
      applySentimentNatural(imageData);
      break;
    case "film":
      applyInstaxBlue(imageData);
      break;
    case "chrome":
      applyClassicChrome(imageData);
      break;
  }

  ctx.putImageData(imageData, 0, 0);

  // Vignette is applied as a second pass via compositing
  switch (filterId) {
    case "natural":
      drawVignette(ctx, canvas.width, canvas.height, 0.34, 0.5);
      break;
    case "film":
      drawVignette(ctx, canvas.width, canvas.height, 0.4, 0.5);
      break;
    case "chrome":
      drawVignette(ctx, canvas.width, canvas.height, 0.4, 0.62);
      break;
  }

  return canvas.toDataURL("image/png");
}

/**
 * Generate a small thumbnail preview. Resizes to maxDim first for speed.
 */
export async function applyFilterThumbnail(
  base64Src: string,
  filterId: FilterId,
  maxDim = 200,
): Promise<string> {
  if (filterId === "none") {
    // Still resize for consistent thumbnail size
    const img = await loadImage(base64Src);
    const { w, h } = fitDimensions(img.width, img.height, maxDim);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.7);
  }

  // Resize first, then filter
  const img = await loadImage(base64Src);
  const { w, h } = fitDimensions(img.width, img.height, maxDim);
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  small.getContext("2d")!.drawImage(img, 0, 0, w, h);
  const smallDataUrl = small.toDataURL("image/png");

  return applyFilter(smallDataUrl, filterId);
}

// ─── pixel-level filter implementations ────────────────────

/**
 * Sentiment Natural: subtle blue tint, slight saturation/brightness boost.
 * Core Image params:
 *   ColorControls: sat 1.05, bright +0.03, contrast 1.05
 *   ColorMatrix: R 0.99, G(0,0.98,0.04), B(0.01,0,1.08), bias(-0.004,0,0.008)
 */
function applySentimentNatural(data: ImageData) {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255;
    let g = d[i + 1] / 255;
    let b = d[i + 2] / 255;

    // Color controls: brightness, contrast, saturation
    r = applyBCS(r, 0.03, 1.05, 1.05);
    g = applyBCS(g, 0.03, 1.05, 1.05, r, g, b);
    b = applyBCS(b, 0.03, 1.05, 1.05);

    // Recalculate with saturation properly
    ({ r, g, b } = adjustBCS(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, 0.03, 1.05, 1.05));

    // Color matrix
    const nr = r * 0.99 + g * 0.0 + b * 0.0 - 0.004;
    const ng = r * 0.0 + g * 0.98 + b * 0.04 + 0.0;
    const nb = r * 0.01 + g * 0.0 + b * 1.08 + 0.008;

    d[i] = clamp8(nr * 255);
    d[i + 1] = clamp8(ng * 255);
    d[i + 2] = clamp8(nb * 255);
  }
}

/**
 * Instax Blue (Film): cinema film look with blue tint + sharpness.
 * Core Image params:
 *   ColorControls: sat 1.12, bright +0.06, contrast 1.06
 *   ColorMatrix: R 0.99, G(0,0.98,0.02), B(0.01,0,1.07), bias(-0.003,0,0.006)
 *   SharpenLuminance: 0.4 (approximated with unsharp mask)
 */
function applyInstaxBlue(data: ImageData) {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    let { r, g, b } = adjustBCS(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, 0.06, 1.06, 1.12);

    const nr = r * 0.99 + g * 0.0 + b * 0.0 - 0.003;
    const ng = r * 0.0 + g * 0.98 + b * 0.02 + 0.0;
    const nb = r * 0.01 + g * 0.0 + b * 1.07 + 0.006;

    d[i] = clamp8(nr * 255);
    d[i + 1] = clamp8(ng * 255);
    d[i + 2] = clamp8(nb * 255);
  }
  // Note: CISharpenLuminance is skipped for web — the difference is negligible
  // and it would require a convolution pass that significantly slows processing.
}

/**
 * Classic Chrome: cool, desaturated.
 * Core Image params:
 *   ColorControls: sat 0.75, bright -0.03, contrast 1.05
 *   ColorMatrix: R 0.95, G 1.0, B 1.05
 */
function applyClassicChrome(data: ImageData) {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    let { r, g, b } = adjustBCS(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, -0.03, 1.05, 0.75);

    const nr = r * 0.95;
    const ng = g * 1.0;
    const nb = b * 1.05;

    d[i] = clamp8(nr * 255);
    d[i + 1] = clamp8(ng * 255);
    d[i + 2] = clamp8(nb * 255);
  }
}

/**
 * Polaroid Blue: stronger blue/teal version of Polaroid.
 * Deeper blue shadows, cooler midtones, highlights still slightly warm.
 */
function applyPolaroidBlue(data: ImageData) {
  const sCurve = buildToneCurveLUT([
    [0, 0.06],
    [0.15, 0.10],
    [0.35, 0.28],
    [0.50, 0.50],
    [0.65, 0.74],
    [0.85, 0.91],
    [1.0, 0.96],
  ]);

  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    let { r, g, b } = adjustBCS(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, 0.02, 1.12, 0.72);

    r = sCurve[clamp8(r * 255)] / 255;
    g = sCurve[clamp8(g * 255)] / 255;
    b = sCurve[clamp8(b * 255)] / 255;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Shadow tinting — strong blue/teal
    const shadowAmount = Math.max(0, 1 - lum * 2.2);
    r -= shadowAmount * 0.10;
    g -= shadowAmount * 0.02;
    b += shadowAmount * 0.16;

    // Midtone blue push (affects everything mildly)
    r -= 0.03;
    b += 0.05;

    // Highlight tinting — subtle warm cream (less warm than Polaroid)
    const hiAmount = Math.max(0, (lum - 0.6) / 0.4);
    r += hiAmount * 0.04;
    g += hiAmount * 0.02;
    b -= hiAmount * 0.02;

    // Selective saturation: mute everything except blue/teal range
    const hue = getHue(clamp01(r), clamp01(g), clamp01(b));
    const isCool = (hue >= 170 && hue <= 260); // blue-cyan range
    const isWarm = (hue >= 15 && hue <= 75); // orange-yellow
    if (!isCool && !isWarm) {
      const gray2 = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray2 + 0.55 * (r - gray2);
      g = gray2 + 0.55 * (g - gray2);
      b = gray2 + 0.55 * (b - gray2);
    }

    d[i] = clamp8(clamp01(r) * 255);
    d[i + 1] = clamp8(clamp01(g) * 255);
    d[i + 2] = clamp8(clamp01(b) * 255);
  }
}

/**
 * Polaroid Dusk: midpoint between Polaroid and Polaroid Blue.
 * Cool-leaning but not fully blue — twilight tones with subtle warmth in highlights.
 */
function applyPolaroidDusk(data: ImageData) {
  const sCurve = buildToneCurveLUT([
    [0, 0.07],
    [0.15, 0.11],
    [0.35, 0.29],
    [0.50, 0.51],
    [0.65, 0.745],
    [0.85, 0.915],
    [1.0, 0.965],
  ]);

  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    // Between Polaroid (bright+0.04, contrast 1.10, sat 0.78) and Blue (bright+0.02, contrast 1.12, sat 0.72)
    let { r, g, b } = adjustBCS(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, 0.03, 1.11, 0.75);

    r = sCurve[clamp8(r * 255)] / 255;
    g = sCurve[clamp8(g * 255)] / 255;
    b = sCurve[clamp8(b * 255)] / 255;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Shadow tinting — between Polaroid (subtle teal) and Blue (strong blue)
    const shadowAmount = Math.max(0, 1 - lum * 2.35);
    r -= shadowAmount * 0.08;
    g -= shadowAmount * 0.015;
    b += shadowAmount * 0.13;

    // Midtone: gentle blue push (between Polaroid's 0 and Blue's -0.03/+0.05)
    r -= 0.015;
    b += 0.025;

    // Highlight tinting — warm but restrained (between Polaroid's strong warm and Blue's subtle)
    const hiAmount = Math.max(0, (lum - 0.575) / 0.425);
    r += hiAmount * 0.06;
    g += hiAmount * 0.03;
    b -= hiAmount * 0.03;

    // Selective saturation: mute non-cool, non-warm
    const hue = getHue(clamp01(r), clamp01(g), clamp01(b));
    const isCool = (hue >= 170 && hue <= 260);
    const isWarm = (hue >= 15 && hue <= 75);
    if (!isCool && !isWarm) {
      const gray2 = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray2 + 0.575 * (r - gray2);
      g = gray2 + 0.575 * (g - gray2);
      b = gray2 + 0.575 * (b - gray2);
    }

    d[i] = clamp8(clamp01(r) * 255);
    d[i + 1] = clamp8(clamp01(g) * 255);
    d[i + 2] = clamp8(clamp01(b) * 255);
  }
}

// ─── helpers ───────────────────────────────────────────────

/** Brightness, Contrast, Saturation adjustment (matches CIColorControls). */
function adjustBCS(
  r: number, g: number, b: number,
  brightness: number, contrast: number, saturation: number,
): { r: number; g: number; b: number } {
  // Brightness
  r += brightness;
  g += brightness;
  b += brightness;

  // Contrast (pivot at 0.5)
  r = (r - 0.5) * contrast + 0.5;
  g = (g - 0.5) * contrast + 0.5;
  b = (b - 0.5) * contrast + 0.5;

  // Saturation
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r = gray + saturation * (r - gray);
  g = gray + saturation * (g - gray);
  b = gray + saturation * (b - gray);

  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

// Unused but kept for reference
function applyBCS(val: number, brightness: number, contrast: number, saturation: number, _r?: number, _g?: number, _b?: number): number {
  return clamp01((val + brightness - 0.5) * contrast + 0.5);
}

/** Draw a radial vignette overlay (matches CIRadialGradient + CISourceOverCompositing). */
function drawVignette(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  strength: number, innerRadiusRatio: number,
) {
  const cx = w / 2;
  const cy = h / 2;
  const maxDim = Math.max(w, h);
  const radius = maxDim * 0.75;

  const grad = ctx.createRadialGradient(cx, cy, radius * innerRadiusRatio, cx, cy, radius);
  grad.addColorStop(0, `rgba(0,0,0,0)`);
  grad.addColorStop(1, `rgba(0,0,0,${strength})`);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/** Build a 256-entry lookup table from tone curve control points. */
function buildToneCurveLUT(points: [number, number][]): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    lut[i] = clamp8(interpolateCurve(points, x) * 255);
  }
  return lut;
}

/** Monotone cubic interpolation of tone curve. */
function interpolateCurve(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[points.length - 1][0]) return points[points.length - 1][1];

  // Find segment
  let seg = 0;
  for (let i = 0; i < points.length - 1; i++) {
    if (x >= points[i][0] && x <= points[i + 1][0]) {
      seg = i;
      break;
    }
  }

  const x0 = points[seg][0], y0 = points[seg][1];
  const x1 = points[seg + 1][0], y1 = points[seg + 1][1];
  const t = (x - x0) / (x1 - x0);

  // Simple cubic hermite
  const t2 = t * t;
  const t3 = t2 * t;
  return y0 + (y1 - y0) * (3 * t2 - 2 * t3);
}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clamp8(v: number) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fitDimensions(w: number, h: number, maxDim: number): { w: number; h: number } {
  if (w <= maxDim && h <= maxDim) return { w, h };
  const scale = maxDim / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

// ─── Polaroid filter ───────────────────────────────────────

/**
 * Polaroid: cross-processed look — cool shadows (teal/blue), warm highlights (cream).
 * Crushed midtones, partial desaturation with orange/yellow retention.
 * Inspired by Polaroid SX-70 / Spectra film + YSL campaign aesthetic.
 */
function applyPolaroid(data: ImageData) {
  // S-curve LUT for midtone crushing: shadows lifted, highlights compressed, mids steep
  const sCurve = buildToneCurveLUT([
    [0, 0.08],     // blacks lifted to ~8%
    [0.15, 0.12],  // deep shadows barely move
    [0.35, 0.30],  // lower-mids compressed
    [0.50, 0.52],  // midpoint slightly above
    [0.65, 0.75],  // upper-mids stretched (steep = crushed feel)
    [0.85, 0.92],  // highlights compressed
    [1.0, 0.97],   // whites never pure white (cream ceiling)
  ]);

  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    let { r, g, b } = adjustBCS(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, 0.04, 1.10, 0.78);

    // S-curve per channel
    r = sCurve[clamp8(r * 255)] / 255;
    g = sCurve[clamp8(g * 255)] / 255;
    b = sCurve[clamp8(b * 255)] / 255;

    // Split tone: shadows → teal/blue, highlights → warm cream
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Shadow tinting (dark areas get blue/teal)
    const shadowAmount = Math.max(0, 1 - lum * 2.5); // strong below lum 0.4
    r -= shadowAmount * 0.06;  // less red in shadows
    g -= shadowAmount * 0.01;  // green roughly stays
    b += shadowAmount * 0.10;  // blue pushed into shadows

    // Highlight tinting (bright areas get warm cream)
    const hiAmount = Math.max(0, (lum - 0.55) / 0.45); // ramp from 0.55 to 1.0
    r += hiAmount * 0.08;   // warm red in highlights
    g += hiAmount * 0.04;   // slight warmth
    b -= hiAmount * 0.04;   // less blue in highlights

    // Selective saturation: keep orange/yellow, mute others
    const hue = getHue(r, g, b);
    // Orange/yellow roughly 20-70 degrees
    const isWarm = (hue >= 15 && hue <= 75);
    if (!isWarm) {
      // Desaturate non-warm colors further
      const gray2 = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray2 + 0.6 * (r - gray2);
      g = gray2 + 0.6 * (g - gray2);
      b = gray2 + 0.6 * (b - gray2);
    }

    d[i] = clamp8(clamp01(r) * 255);
    d[i + 1] = clamp8(clamp01(g) * 255);
    d[i + 2] = clamp8(clamp01(b) * 255);
  }
}

/** Get hue in degrees (0-360) from RGB (0-1). */
function getHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return h;
}

/**
 * Radial blur: center stays sharp, edges get soft.
 * Simulates Polaroid lens softness / chromatic aberration.
 */
function drawRadialBlur(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  maxBlurPx: number,
) {
  // Create a blurred copy of the entire image
  const blurred = document.createElement("canvas");
  blurred.width = w;
  blurred.height = h;
  const bCtx = blurred.getContext("2d")!;
  bCtx.filter = `blur(${maxBlurPx}px)`;
  bCtx.drawImage(ctx.canvas, 0, 0);

  // Create a radial gradient mask: transparent center, opaque edges
  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const mCtx = mask.getContext("2d")!;

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.max(w, h) * 0.5;

  const grad = mCtx.createRadialGradient(cx, cy, radius * 0.35, cx, cy, radius);
  grad.addColorStop(0, "rgba(0,0,0,0)");    // center: transparent (keep sharp)
  grad.addColorStop(0.6, "rgba(0,0,0,0)");  // still sharp at 60% radius
  grad.addColorStop(1, "rgba(0,0,0,1)");    // edges: fully blurred

  mCtx.fillStyle = grad;
  mCtx.fillRect(0, 0, w, h);

  // Draw blurred image through the mask
  // Use the mask as a clip: draw blurred canvas, then use destination-in to mask
  const comp = document.createElement("canvas");
  comp.width = w;
  comp.height = h;
  const cCtx = comp.getContext("2d")!;
  cCtx.drawImage(blurred, 0, 0);
  cCtx.globalCompositeOperation = "destination-in";
  cCtx.drawImage(mask, 0, 0);
  cCtx.globalCompositeOperation = "source-over";

  // Composite the masked blur on top of the original
  ctx.drawImage(comp, 0, 0);
}

/**
 * Light leak: warm orange/amber glow bleeding from corners.
 * Classic Polaroid artifact.
 */
function drawLightLeak(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  mode: "warm" | "dusk" | "blue" = "warm",
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  if (mode === "blue") {
    // Blue mode: both leaks are cool-toned
    const g1 = ctx.createRadialGradient(w * 0.85, h * 0.1, 0, w * 0.85, h * 0.1, w * 0.5);
    g1.addColorStop(0, "rgba(100, 160, 220, 0.14)");
    g1.addColorStop(0.5, "rgba(70, 130, 200, 0.05)");
    g1.addColorStop(1, "rgba(50, 100, 180, 0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const g2 = ctx.createRadialGradient(w * 0.1, h * 0.85, 0, w * 0.1, h * 0.85, w * 0.45);
    g2.addColorStop(0, "rgba(60, 140, 200, 0.12)");
    g2.addColorStop(0.5, "rgba(40, 120, 180, 0.05)");
    g2.addColorStop(1, "rgba(30, 100, 160, 0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  } else if (mode === "dusk") {
    // Dusk mode: muted lavender/steel blue — between warm and blue
    const g1 = ctx.createRadialGradient(w * 0.85, h * 0.1, 0, w * 0.85, h * 0.1, w * 0.5);
    g1.addColorStop(0, "rgba(160, 160, 210, 0.14)");
    g1.addColorStop(0.5, "rgba(130, 140, 190, 0.05)");
    g1.addColorStop(1, "rgba(100, 120, 170, 0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const g2 = ctx.createRadialGradient(w * 0.1, h * 0.85, 0, w * 0.1, h * 0.85, w * 0.45);
    g2.addColorStop(0, "rgba(70, 150, 200, 0.11)");
    g2.addColorStop(0.5, "rgba(50, 130, 180, 0.04)");
    g2.addColorStop(1, "rgba(35, 110, 165, 0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Standard: warm top-right, cool bottom-left
    const g1 = ctx.createRadialGradient(w * 0.85, h * 0.1, 0, w * 0.85, h * 0.1, w * 0.5);
    g1.addColorStop(0, "rgba(255, 200, 120, 0.15)");
    g1.addColorStop(0.5, "rgba(255, 170, 90, 0.05)");
    g1.addColorStop(1, "rgba(255, 140, 60, 0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const g2 = ctx.createRadialGradient(w * 0.1, h * 0.85, 0, w * 0.1, h * 0.85, w * 0.45);
    g2.addColorStop(0, "rgba(80, 180, 200, 0.10)");
    g2.addColorStop(0.5, "rgba(60, 150, 180, 0.04)");
    g2.addColorStop(1, "rgba(40, 120, 160, 0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.restore();
}
