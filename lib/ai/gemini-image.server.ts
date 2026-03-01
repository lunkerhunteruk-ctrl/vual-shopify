/**
 * VUAL Studio — Gemini Image Generation Engine
 * Ported from VUAL platform: app/api/ai/gemini-image/route.ts
 */

const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_RETRIES = 3;

// --- Types ---

export interface ModelSettings {
  gender: string;
  height: number;
  ethnicity: string;
  pose: string;
}

export interface SizeSpec {
  columns: string[];
  rows: { size: string; values: Record<string, string> }[];
}

export interface GarmentSize {
  bodyWidth?: number;
  length?: number;
  sleeveLength?: number;
  shoulderWidth?: number;
}

export interface GenerationRequest {
  garmentImages: string[]; // base64 data URLs
  secondGarmentImages?: string[];
  thirdGarmentImages?: string[];
  fourthGarmentImages?: string[];
  fifthGarmentImages?: string[];
  modelSettings: ModelSettings;
  modelImage?: string;
  background: string;
  aspectRatio: string;
  customPrompt?: string;
  garmentSize?: GarmentSize;
  garmentSizeSpecs?: SizeSpec;
  locale?: string;
}

export interface GenerationResult {
  success: boolean;
  images: string[];
  prompt?: string;
  error?: string;
}

// --- Lookup tables ---

const backgroundDescriptions: Record<string, string> = {
  studioWhite:
    "clean white studio background with soft professional lighting",
  studioGray:
    "neutral gray studio background with professional fashion photography lighting",
  outdoorUrban:
    "modern urban street background with city architecture, natural daylight",
  outdoorNature:
    "natural outdoor setting with soft natural lighting, greenery",
  cafeIndoor: "stylish cafe interior with warm ambient lighting",
  beachResort:
    "tropical beach or resort setting with bright natural sunlight",
};

const ethnicityDescriptions: Record<string, string> = {
  japanese: "Japanese",
  korean: "Korean",
  chinese: "Chinese",
  "eastern-european": "Eastern European",
  "western-european": "Western European",
  african: "African",
  latin: "Latin American",
  "southeast-asian": "Southeast Asian",
};

const poseDescriptions: Record<string, string> = {
  standing: "standing with confident posture",
  walking: "walking naturally mid-stride",
  sitting: "sitting elegantly",
  dynamic: "in a dynamic fashion pose",
  leaning: "leaning casually against a wall",
};

// --- Helpers ---

function extractBase64(dataUrl: string): {
  data: string;
  mimeType: string;
} | null {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return null;
}

async function callGeminiAPI(
  parts: any[],
  aspectRatio: string = "3:4"
): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio },
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// --- Prompt builders ---

function buildPrompt(req: GenerationRequest, counts: number[]): string {
  const { modelSettings, modelImage, garmentSize, garmentSizeSpecs, background, customPrompt, locale } = req;

  let sizeDescription = "";
  if (garmentSizeSpecs && garmentSizeSpecs.rows.length > 0) {
    const mRow =
      garmentSizeSpecs.rows.find((r) => r.size === "M") ||
      garmentSizeSpecs.rows[0];
    const sizeDetails = Object.entries(mRow.values)
      .filter(([_, v]) => v)
      .map(([k, v]) => `${k}: ${v}cm`)
      .join(", ");
    if (sizeDetails) {
      sizeDescription =
        locale === "ja"
          ? `この服のサイズ${mRow.size}は ${sizeDetails} です。`
          : `This garment in size ${mRow.size} has measurements: ${sizeDetails}.`;
    }
  }

  let fitDescription = "";
  if (garmentSize?.length && modelSettings.height) {
    const lengthRatio = garmentSize.length / modelSettings.height;
    if (lengthRatio > 0.5)
      fitDescription = "longer length reaching below hip";
    else if (lengthRatio > 0.4)
      fitDescription = "standard length around waist";
    else fitDescription = "cropped short length";
  }

  const [c1, c2, c3, c4, c5] = counts;
  const firstImgRef =
    c1 > 1
      ? `the first ${c1} provided images (showing different angles/details of the same garment)`
      : `the first provided image`;
  const garmentDesc = `wearing EXACTLY the garment shown in ${firstImgRef}`;

  const secondGarmentDesc =
    c2 > 0
      ? ` and also wearing the item from ${c2 > 1 ? `the next ${c2} images` : "the next garment image"}`
      : "";
  const thirdGarmentDesc =
    c3 > 0
      ? ` and wearing the shoes/accessories from ${c3 > 1 ? `the following ${c3} images` : "the following garment image"}`
      : "";
  const fourthGarmentDesc =
    c4 > 0
      ? ` and carrying/wearing the bag/accessory from ${c4 > 1 ? `the next ${c4} images` : "the next accessory image"}`
      : "";
  const fifthGarmentDesc =
    c5 > 0
      ? ` and also wearing/using the accessory from ${c5 > 1 ? `the next ${c5} images` : "the next accessory image"}`
      : "";

  const modelDescription = modelImage
    ? `Generate an image using the EXACT model appearance from the provided model reference image (face, body type, skin tone must match exactly)`
    : `A ${ethnicityDescriptions[modelSettings.ethnicity] || modelSettings.ethnicity} ${modelSettings.gender === "female" ? "woman" : "man"}`;

  const multiImageNote =
    counts.some((c) => c > 1)
      ? `MULTIPLE REFERENCE IMAGES: When multiple images are provided for a garment, use ALL of them to understand the garment's complete details from different angles.`
      : "";

  const parts = [
    `CRITICAL INSTRUCTION - GARMENT FIDELITY IS THE TOP PRIORITY:`,
    `You MUST reproduce the EXACT garments from the provided reference images with 100% accuracy.`,
    `DO NOT create similar-looking alternatives. The garments must be PIXEL-PERFECT matches to the originals.`,
    multiImageNote,
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
    `Professional high-end fashion photography.`,
    modelDescription,
    `who is ${modelSettings.height}cm tall,`,
    `${poseDescriptions[modelSettings.pose] || modelSettings.pose},`,
    garmentDesc +
      secondGarmentDesc +
      thirdGarmentDesc +
      fourthGarmentDesc +
      fifthGarmentDesc +
      ".",
    customPrompt
      ? `MANDATORY STYLING (DO NOT IGNORE): ${customPrompt}.`
      : "",
    sizeDescription,
    fitDescription ? `The garment appears with ${fitDescription}.` : "",
    `${backgroundDescriptions[background] || background}.`,
    `Sharp focus, editorial fashion magazine quality, ultra high resolution 8K.`,
    `Extremely detailed, photorealistic rendering with fine texture details.`,
    `Realistic skin texture, natural pose, professional model.`,
    `IMPORTANT: Show the full body including feet if shoes/footwear are included.`,
    `CRITICAL: DO NOT render any text, labels, watermarks, or words on the image.`,
    `OUTPUT FORMAT: Generate the image in ${req.aspectRatio} aspect ratio.`,
    `REMINDER: The garments MUST be exact copies from the reference images.`,
  ];

  return parts.filter(Boolean).join(" ");
}

function buildSimplifiedPrompt(req: GenerationRequest): string {
  const { modelSettings, modelImage, background, customPrompt } = req;
  const gender = modelSettings.gender === "female" ? "woman" : "man";
  const ethnicity =
    ethnicityDescriptions[modelSettings.ethnicity] || modelSettings.ethnicity;
  const model = modelImage
    ? "the model from the reference image"
    : `a ${ethnicity} ${gender}`;
  const styleNote = customPrompt ? ` IMPORTANT STYLING: ${customPrompt}.` : "";
  return `E-commerce fashion photography: ${model}, ${modelSettings.height}cm tall, ${poseDescriptions[modelSettings.pose] || modelSettings.pose}, wearing the garment(s) from the provided reference images.${styleNote} ${backgroundDescriptions[background] || background}. ${req.aspectRatio} aspect ratio. Full body shot, professional quality, no text or watermarks.`;
}

function buildMinimalPrompt(req: GenerationRequest): string {
  const { modelSettings, modelImage, background, customPrompt } = req;
  const gender = modelSettings.gender === "female" ? "woman" : "man";
  const model = modelImage ? "this person" : `a ${gender}`;
  const styleNote = customPrompt ? ` ${customPrompt}.` : "";
  return `Fashion catalog photo: ${model} wearing the garment(s) from the reference images.${styleNote} ${backgroundDescriptions[background] || "White background"}. ${req.aspectRatio} aspect ratio. Full body, clean photo.`;
}

// --- Main generation function ---

export async function generateImage(
  req: GenerationRequest
): Promise<GenerationResult> {
  const allImageSets = [
    req.garmentImages,
    req.secondGarmentImages || [],
    req.thirdGarmentImages || [],
    req.fourthGarmentImages || [],
    req.fifthGarmentImages || [],
  ];

  if (allImageSets[0].length === 0) {
    return { success: false, images: [], error: "Garment image is required" };
  }

  // Build image parts
  const imageParts: any[] = [];

  for (const img of allImageSets[0]) {
    const imageData = extractBase64(img);
    if (imageData) {
      imageParts.push({
        inline_data: { mime_type: imageData.mimeType, data: imageData.data },
      });
    }
  }

  if (req.modelImage) {
    const modelImageData = extractBase64(req.modelImage);
    if (modelImageData) {
      imageParts.push({
        inline_data: {
          mime_type: modelImageData.mimeType,
          data: modelImageData.data,
        },
      });
    }
  }

  for (let i = 1; i < allImageSets.length; i++) {
    for (const img of allImageSets[i]) {
      const imageData = extractBase64(img);
      if (imageData) {
        imageParts.push({
          inline_data: { mime_type: imageData.mimeType, data: imageData.data },
        });
      }
    }
  }

  const counts = allImageSets.map((set) => set.length);
  const promptVariants = [
    buildPrompt(req, counts),
    buildSimplifiedPrompt(req),
    buildMinimalPrompt(req),
  ];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const prompt =
        promptVariants[attempt] || promptVariants[promptVariants.length - 1];
      console.log(
        `[VUAL Studio] Attempt ${attempt + 1}/${MAX_RETRIES} using ${GEMINI_MODEL}...`
      );

      const parts = [{ text: prompt }, ...imageParts];
      const data = await callGeminiAPI(parts, req.aspectRatio);

      const candidates = data.candidates || [];
      const finishReason = candidates[0]?.finishReason;

      if (finishReason === "IMAGE_PROHIBITED_CONTENT") {
        lastError = new Error(
          `IMAGE_PROHIBITED_CONTENT on attempt ${attempt + 1}`
        );
        if (attempt + 1 < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000));
        }
        continue;
      }

      // Extract generated images
      const images: string[] = [];
      for (const candidate of candidates) {
        const responseParts = candidate.content?.parts || [];
        for (const part of responseParts) {
          const inlineData = part.inline_data || part.inlineData;
          if (inlineData?.data) {
            const base64 = inlineData.data;
            const mimeType =
              inlineData.mime_type || inlineData.mimeType || "image/png";
            images.push(`data:${mimeType};base64,${base64}`);
          }
        }
      }

      if (images.length === 0) {
        lastError = new Error(
          `No image in response. finishReason=${finishReason}`
        );
        if (attempt + 1 < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000));
        }
        continue;
      }

      return { success: true, images, prompt };
    } catch (error) {
      console.error(`[VUAL Studio] Attempt ${attempt + 1} error:`, error);
      lastError = error as Error;
    }
  }

  return {
    success: false,
    images: [],
    error: `Generation failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  };
}
