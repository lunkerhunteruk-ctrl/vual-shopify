/**
 * Watermark utility for VUAL Fitting results.
 * Adds store name + VUAL branding to bottom-right of generated images.
 * Ported from VUAL platform: lib/utils/image-watermark.ts
 */

import sharp from "sharp";

/**
 * Add watermark to a base64 data URL image.
 * Returns watermarked image as base64 data URL.
 */
export async function addWatermark(
  dataUrl: string,
  storeName: string
): Promise<string> {
  // Extract raw base64 data
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return dataUrl; // return as-is if not a valid data URL

  const imageBuffer = Buffer.from(match[2], "base64");

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 768;
  const height = metadata.height || 1024;

  const storeFontSize = Math.round(width * 0.022);
  const vualFontSize = Math.round(width * 0.018);
  const paddingX = Math.round(width * 0.03);
  const paddingY = Math.round(height * 0.1);
  const lineGap = Math.round(storeFontSize * 1.4);

  const escapedName = storeName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const textX = width - paddingX;
  const vualY = height - paddingY;
  const storeY = vualY - lineGap;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <text
    x="${textX}"
    y="${storeY}"
    text-anchor="end"
    font-family="sans-serif"
    font-size="${storeFontSize}"
    font-weight="500"
    letter-spacing="0.5"
    fill="white"
    opacity="0.85"
  >Styled by ${escapedName}</text>
  <text
    x="${textX}"
    y="${vualY}"
    text-anchor="end"
    font-family="sans-serif"
    font-size="${vualFontSize}"
    font-weight="500"
    letter-spacing="0.3"
    fill="white"
    opacity="0.70"
  >virtual try-on by VUAL</text>
</svg>`;

  const resultBuffer = await sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();

  const resultBase64 = resultBuffer.toString("base64");
  return `data:image/jpeg;base64,${resultBase64}`;
}
