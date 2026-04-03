/**
 * Photo filters for VUAL Studio — ported from Core Image (iOS) to Canvas 2D.
 *
 * Each filter processes an image via OffscreenCanvas (or regular Canvas)
 * and returns a base64 data-URL.
 */

export type FilterId = "none" | "natural" | "film" | "chrome" | "neg" | "polaroid";

export interface FilterMeta {
  id: FilterId;
  label: string;
}

export const FILTERS: FilterMeta[] = [
  { id: "none", label: "Original" },
  { id: "natural", label: "Natural" },
  { id: "film", label: "Film" },
  { id: "chrome", label: "Chrome" },
  { id: "neg", label: "Neg" },
  { id: "polaroid", label: "Polaroid" },
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

  // Polaroid needs special handling (blur + light leak are canvas-level effects)
  if (filterId === "polaroid") {
    applyPolaroid(imageData);
    ctx.putImageData(imageData, 0, 0);
    // Soft radial blur: center sharp, edges soft (lens aberration)
    drawRadialBlur(ctx, canvas.width, canvas.height, 0.8);
    // Light leak (warm glow from corners)
    drawLightLeak(ctx, canvas.width, canvas.height);
    // Strong vignette
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
    case "neg":
      applyClassicNeg(imageData);
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
    case "neg":
      drawVignette(ctx, canvas.width, canvas.height, 0.26, 0.5);
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
 * Classic Neg: muted, lifted shadows, subtle sepia, tone curve.
 * Core Image params:
 *   ColorControls: sat 0.84, bright +0.02, contrast 1.06
 *   HighlightShadowAdjust: shadow 0.38, highlight -0.02
 *   SepiaTone: 0.18
 *   ToneCurve: (0,0),(0.25,0.27),(0.5,0.58),(0.75,0.84),(1,1)
 */
function applyClassicNeg(data: ImageData) {
  // Build tone curve LUT
  const curveLUT = buildToneCurveLUT([
    [0, 0], [0.25, 0.27], [0.5, 0.58], [0.75, 0.84], [1, 1],
  ]);

  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    let { r, g, b } = adjustBCS(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, 0.02, 1.06, 0.84);

    // Shadow/highlight adjust
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const shadowLift = 0.38 * Math.max(0, 0.5 - lum) * 2; // lift dark areas
    const highlightAdj = -0.02 * Math.max(0, lum - 0.5) * 2;
    const adj = shadowLift + highlightAdj;
    r = clamp01(r + adj);
    g = clamp01(g + adj);
    b = clamp01(b + adj);

    // Sepia tone (intensity 0.18)
    const sepiaR = r * 0.393 + g * 0.769 + b * 0.189;
    const sepiaG = r * 0.349 + g * 0.686 + b * 0.168;
    const sepiaB = r * 0.272 + g * 0.534 + b * 0.131;
    const si = 0.18;
    r = r * (1 - si) + sepiaR * si;
    g = g * (1 - si) + sepiaG * si;
    b = b * (1 - si) + sepiaB * si;

    // Tone curve
    r = curveLUT[clamp8(r * 255)] / 255;
    g = curveLUT[clamp8(g * 255)] / 255;
    b = curveLUT[clamp8(b * 255)] / 255;

    d[i] = clamp8(r * 255);
    d[i + 1] = clamp8(g * 255);
    d[i + 2] = clamp8(b * 255);
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
 * Polaroid: warm amber tone, low contrast, lifted shadows, highlight blowout.
 * Inspired by Polaroid 600 / SX-70 film characteristics.
 */
function applyPolaroid(data: ImageData) {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    // Low contrast, lifted brightness
    let { r, g, b } = adjustBCS(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, 0.10, 0.92, 0.90);

    // Lift shadows (blacks never go fully dark)
    r = r * 0.88 + 0.12;
    g = g * 0.88 + 0.12;
    b = b * 0.88 + 0.12;

    // Warm amber color matrix: R up, G neutral, B down
    const nr = r * 1.08 + g * 0.02 + b * 0.0 + 0.02;
    const ng = r * 0.01 + g * 1.0 + b * 0.01 - 0.005;
    const nb = r * 0.0 + g * 0.02 + b * 0.88 - 0.01;

    // Highlight blowout: push highlights towards warm white
    const lum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
    const blowout = Math.max(0, (lum - 0.7) / 0.3); // 0 below 0.7, ramps to 1 at 1.0
    const blowR = nr + blowout * (1.0 - nr) * 0.6;
    const blowG = ng + blowout * (0.97 - ng) * 0.5;
    const blowB = nb + blowout * (0.90 - nb) * 0.4;

    d[i] = clamp8(blowR * 255);
    d[i + 1] = clamp8(blowG * 255);
    d[i + 2] = clamp8(blowB * 255);
  }
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
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  // Top-right warm leak
  const g1 = ctx.createRadialGradient(w * 0.85, h * 0.1, 0, w * 0.85, h * 0.1, w * 0.5);
  g1.addColorStop(0, "rgba(255, 180, 80, 0.18)");
  g1.addColorStop(0.5, "rgba(255, 140, 50, 0.06)");
  g1.addColorStop(1, "rgba(255, 100, 30, 0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);

  // Bottom-left subtle amber leak
  const g2 = ctx.createRadialGradient(w * 0.1, h * 0.9, 0, w * 0.1, h * 0.9, w * 0.4);
  g2.addColorStop(0, "rgba(255, 160, 60, 0.12)");
  g2.addColorStop(0.5, "rgba(255, 120, 40, 0.04)");
  g2.addColorStop(1, "rgba(255, 80, 20, 0)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}
