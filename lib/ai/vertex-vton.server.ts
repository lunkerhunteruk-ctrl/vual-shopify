/**
 * VUAL Fitting — Virtual Try-On Engine
 * Backed by APIMart (gemini-3.1-flash-image-preview via nano-banana-2)
 * Supports coordinate try-on: multiple garments in a single generation
 */

import { generateImages } from "./apimart-client.server";

const MAX_RETRIES = 1;

export interface VTONModelSettings {
  gender?: string;
  height?: number;
}

export interface VTONRequest {
  personImage: string; // Base64 data URL
  garmentImages: string[]; // Array of base64 data URLs (1-5 items)
  categories: string[]; // Category per garment (same order)
  modelSettings?: VTONModelSettings;
}

export interface VTONResponse {
  resultImage: string; // Base64 data URL
  confidence: number;
  processingTime: number;
}

function toDataUrl(dataUrl: string): string | null {
  // Already a data URI
  if (dataUrl.startsWith("data:")) return dataUrl;
  // Raw base64 — assume JPEG
  if (dataUrl.length > 100) return `data:image/jpeg;base64,${dataUrl}`;
  return null;
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case "upper_body":
      return "top/shirt/blouse";
    case "lower_body":
      return "pants/skirt/bottom";
    case "footwear":
      return "shoes/footwear";
    case "dresses":
      return "dress/full outfit";
    case "bags":
      return "bag/handbag";
    case "accessories":
      return "accessory/scarf/hat";
    case "jewelry_ring":
      return "ring";
    case "jewelry_necklace":
      return "necklace/pendant";
    case "jewelry_earring":
      return "earring";
    case "jewelry_bracelet":
      return "bracelet/bangle";
    default:
      return "garment";
  }
}

function buildModelDesc(ms?: VTONModelSettings): string {
  if (!ms) return "";
  const parts: string[] = [];
  if (ms.height) parts.push(`The person is ${ms.height}cm tall.`);
  if (ms.gender) {
    const g = ms.gender === "female" ? "woman" : "man";
    parts.push(`The person is a ${g}.`);
  }
  return parts.join(" ");
}

function needsFullBody(categories: string[]): boolean {
  return categories.some((c) =>
    ["lower_body", "footwear", "dresses"].includes(c)
  );
}

function isFootwearOnly(categories: string[]): boolean {
  return categories.length > 0 && categories.every((c) => c === "footwear");
}

function buildFootwearVTONPrompt(): string {
  return [
    `CRITICAL — SHOE FIDELITY IS THE TOP PRIORITY:`,
    `Reproduce the EXACT shoes from the reference image with 100% accuracy.`,
    `Preserve exact color, material, sole design, stitching, and all details.`,
    ``,
    `Virtual try-on: The FIRST image shows the customer's feet.`,
    `Place the shoes from the SECOND image naturally on their feet.`,
    `Close-up shot focused on the feet and ankles — do NOT show full body.`,
    `Clean, neutral background. Sharp focus on the shoes.`,
    `Professional shoe photography quality, eye-level angle.`,
    `CRITICAL: Show ONLY the feet and lower ankle area — close-up, NOT full body.`,
    `CRITICAL: DO NOT render any text, labels, or watermarks.`,
    `CRITICAL: Generate ONE single close-up shot. No collages or split views.`,
  ].filter(Boolean).join(" ");
}

function buildSimplifiedFootwearVTONPrompt(): string {
  return `Virtual try-on: Place the shoes from image 2 on the feet from image 1. Close-up of feet and ankles, sharp focus on shoes, clean background. One image only, no collages.`;
}

function buildMinimalFootwearVTONPrompt(): string {
  return `Photo: shoes from image 2 on the feet from image 1. Close-up, clean background.`;
}

function buildCoordinatePrompt(
  categories: string[],
  imageCount: number,
  modelSettings?: VTONModelSettings
): string {
  const fullBody = needsFullBody(categories);
  const shotDesc = fullBody
    ? "Full body shot showing the complete outfit including feet."
    : "Half-body shot, waist up, clearly showing the upper garment(s). Do NOT show the lower body or feet.";
  const garmentDescs: string[] = [];
  for (let i = 0; i < categories.length; i++) {
    const label = categoryLabel(categories[i]);
    const ordinal =
      i === 0
        ? "first"
        : i === 1
          ? "second"
          : i === 2
            ? "third"
            : i === 3
              ? "fourth"
              : "fifth";
    garmentDescs.push(
      `the ${label} from the ${ordinal} garment image`
    );
  }

  const allGarments = garmentDescs.join(", ");
  const modelDesc = buildModelDesc(modelSettings);

  return [
    `CRITICAL INSTRUCTION - GARMENT FIDELITY IS THE TOP PRIORITY:`,
    `You MUST reproduce the EXACT garments from the provided reference images with 100% accuracy.`,
    `DO NOT create similar-looking alternatives. The garments must be PIXEL-PERFECT matches to the originals.`,
    ``,
    `GARMENT DETAILS TO PRESERVE EXACTLY:`,
    `- Exact color and shade (no color shifts)`,
    `- Exact pattern, print, or texture`,
    `- Exact neckline shape and style`,
    `- Exact sleeve length, cuff style, and details`,
    `- Exact buttons, zippers, pockets, seams, and all design elements`,
    `- Exact fabric drape and material appearance`,
    `- Exact silhouette and fit`,
    ``,
    `Generate a professional fashion photo for virtual try-on.`,
    `The FIRST image is the customer's photo — use their EXACT face, body type, pose, and skin tone.`,
    `IMPORTANT: Completely REMOVE whatever clothing the customer is currently wearing. Replace ALL existing garments entirely with ONLY the provided reference garments. No part of the customer's original clothing should be visible.`,
    modelDesc,
    `Dress this person in a coordinated outfit using ALL of the following garments: ${allGarments}.`,
    ``,
    `The result must show the person wearing ALL ${categories.length} items together as a complete coordinated outfit.`,
    `Studio white background, professional lighting.`,
    shotDesc,
    `High quality, 8K resolution, fashion magazine style.`,
    `CRITICAL: Generate EXACTLY ONE single person. Do NOT create collages, split views, or multiple copies.`,
    `CRITICAL: DO NOT render any text, labels, watermarks, or words on the image.`,
    `REMINDER: The garments MUST be exact copies from the reference images.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildSimplifiedCoordinatePrompt(
  categories: string[],
  modelSettings?: VTONModelSettings
): string {
  const items = categories.map((c) => categoryLabel(c)).join(", ");
  const modelDesc = buildModelDesc(modelSettings);
  const shotDesc = needsFullBody(categories)
    ? "full body"
    : "half-body waist-up shot, do not show lower body";
  return `Virtual try-on: Show the person from the first image wearing these items from the garment images: ${items}. Remove all original clothing the person is wearing — only the provided garments should be visible. ${modelDesc} Professional fashion photography, white background, ${shotDesc}. One person only, no collages. Garments must match the reference images exactly.`;
}

function buildMinimalCoordinatePrompt(
  categories: string[],
  modelSettings?: VTONModelSettings
): string {
  const items = categories.map((c) => categoryLabel(c)).join(", ");
  const modelDesc = buildModelDesc(modelSettings);
  const shotDesc = needsFullBody(categories) ? "full body" : "waist-up only";
  return `Fashion photo: Person from image 1 wearing the ${items} from the other images. Remove all original clothing. ${modelDesc} White background, ${shotDesc}, one person.`;
}

// --- Jewelry VTON helpers ---

function isJewelryCategory(cat: string): boolean {
  return ["jewelry_ring", "jewelry_necklace", "jewelry_earring", "jewelry_bracelet"].includes(cat);
}

function jewelryBodyPart(cat: string): string {
  switch (cat) {
    case "jewelry_ring": return "hand and fingers";
    case "jewelry_necklace": return "neck and décolletage";
    case "jewelry_earring": return "ear and side of face";
    case "jewelry_bracelet": return "wrist and forearm";
    default: return "hand";
  }
}

function buildJewelryVTONPrompt(
  category: string,
  modelSettings?: VTONModelSettings
): string {
  const bodyPart = jewelryBodyPart(category);
  const modelDesc = buildModelDesc(modelSettings);
  return [
    `CRITICAL — JEWELRY FIDELITY IS THE TOP PRIORITY:`,
    `Reproduce the EXACT jewelry from the reference image with 100% accuracy.`,
    `Preserve exact metal color/finish, gemstone details, design pattern, and proportions.`,
    ``,
    `Virtual try-on: The FIRST image shows the customer's ${bodyPart}.`,
    `Place the jewelry piece from the SECOND image naturally on their ${bodyPart}.`,
    modelDesc,
    `Close-up shot focused on the ${bodyPart} with the jewelry.`,
    `Clean, elegant background. Sharp focus on jewelry details.`,
    `Professional jewelry photography quality.`,
    `CRITICAL: Show ONLY the ${bodyPart} area — close-up, NOT full body.`,
    `CRITICAL: DO NOT render any text, labels, or watermarks.`,
    `CRITICAL: Generate ONE single close-up shot. No collages or split views.`,
  ].filter(Boolean).join(" ");
}

function buildSimplifiedJewelryVTONPrompt(
  category: string,
  modelSettings?: VTONModelSettings
): string {
  const bodyPart = jewelryBodyPart(category);
  const modelDesc = buildModelDesc(modelSettings);
  return `Virtual try-on: Place the jewelry from image 2 on the ${bodyPart} from image 1. ${modelDesc} Close-up, sharp focus, clean background. One image only.`;
}

function buildMinimalJewelryVTONPrompt(
  category: string
): string {
  const bodyPart = jewelryBodyPart(category);
  return `Photo: jewelry from image 2 on the ${bodyPart} from image 1. Close-up, clean background.`;
}

export async function generateVTON(
  request: VTONRequest
): Promise<VTONResponse> {
  const startTime = Date.now();

  if (request.garmentImages.length === 0) {
    throw new Error("At least one garment image is required");
  }

  // Build image_urls: person first, then all garments
  const imageUrls: string[] = [];

  const personUrl = toDataUrl(request.personImage);
  if (!personUrl) throw new Error("Invalid person image data");
  imageUrls.push(personUrl);

  for (const garmentImg of request.garmentImages) {
    const url = toDataUrl(garmentImg);
    if (url) imageUrls.push(url);
  }

  // Detect mode from categories
  const jewelry =
    request.categories.length > 0 &&
    isJewelryCategory(request.categories[0]);
  const jewelryCat = jewelry ? request.categories[0] : "";
  const fwOnly = isFootwearOnly(request.categories);

  const promptVariants = fwOnly
    ? [
        buildFootwearVTONPrompt(),
        buildSimplifiedFootwearVTONPrompt(),
        buildMinimalFootwearVTONPrompt(),
      ]
    : jewelry
    ? [
        buildJewelryVTONPrompt(jewelryCat, request.modelSettings),
        buildSimplifiedJewelryVTONPrompt(jewelryCat, request.modelSettings),
        buildMinimalJewelryVTONPrompt(jewelryCat),
      ]
    : [
        buildCoordinatePrompt(
          request.categories,
          request.garmentImages.length,
          request.modelSettings
        ),
        buildSimplifiedCoordinatePrompt(request.categories, request.modelSettings),
        buildMinimalCoordinatePrompt(request.categories, request.modelSettings),
      ];

  const vtonAspectRatio = fwOnly ? "1:1" : jewelry ? "1:1" : "3:4";

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const prompt =
        promptVariants[attempt] || promptVariants[promptVariants.length - 1];
      console.log(
        `[VTON] Attempt ${attempt + 1}/${MAX_RETRIES} via APIMart, ${request.garmentImages.length} item(s)${jewelry ? " (jewelry)" : ""}...`
      );

      const images = await generateImages({
        prompt,
        size: vtonAspectRatio,
        resolution: "1K",
        image_urls: imageUrls,
      });

      const processingTime = Date.now() - startTime;
      console.log(`[VTON] Success on attempt ${attempt + 1}`);
      return {
        resultImage: images[0],
        confidence: 0.9,
        processingTime,
      };
    } catch (error) {
      console.error(`[VTON] Attempt ${attempt + 1} error:`, error);
      lastError = error as Error;
      if (attempt + 1 < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  throw new Error(
    `VTON failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message}`
  );
}

export async function imageUrlToBase64(url: string): Promise<string> {
  // Shopify image_url returns protocol-relative URLs (//cdn.shopify.com/...)
  const fullUrl = url.startsWith("//") ? `https:${url}` : url;
  const response = await fetch(fullUrl);
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return base64;
}

export function base64ToDataUrl(
  base64: string,
  mimeType: string = "image/png"
): string {
  if (base64.startsWith("data:")) {
    return base64;
  }
  return `data:${mimeType};base64,${base64}`;
}
