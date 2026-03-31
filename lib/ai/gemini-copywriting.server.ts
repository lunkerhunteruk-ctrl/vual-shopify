/**
 * VUAL Studio — AI Collection Copywriting
 * Generates evocative collection titles and descriptions using Gemini 2.5 Flash-Lite
 * Accepts the generated look image + product text data for context-aware copy
 */

const GEMINI_TEXT_MODEL = "gemini-2.5-flash-lite";
const GEMINI_TEXT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent`;

interface ProductInfo {
  title: string;
  description?: string;
  productType?: string;
  vendor?: string;
}

interface CopywritingResult {
  title: string;
  descriptionHtml: string;
}

/**
 * Generate a collection title and HTML description from product data + look image.
 * @param products - Product info array
 * @param locale - Shop locale for output language
 * @param lookImageBase64 - Base64 of the generated look image (without data: prefix)
 */
export async function generateCollectionCopy(
  products: ProductInfo[],
  locale: string = "en",
  lookImageBase64?: string
): Promise<CopywritingResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const productSummary = products
    .map((p, i) => {
      let line = `${i + 1}. "${p.title}"`;
      if (p.vendor) line += ` by ${p.vendor}`;
      if (p.productType) line += ` (${p.productType})`;
      if (p.description) line += ` — ${p.description.slice(0, 300)}`;
      return line;
    })
    .join("\n");

  const langInstruction = locale.startsWith("ja")
    ? "Output MUST be in Japanese (日本語)."
    : locale.startsWith("fr")
      ? "Output MUST be in French."
      : locale.startsWith("ko")
        ? "Output MUST be in Korean."
        : locale.startsWith("zh")
          ? "Output MUST be in Chinese."
          : locale.startsWith("de")
            ? "Output MUST be in German."
            : locale.startsWith("es")
              ? "Output MUST be in Spanish."
              : `Output MUST be in the language matching locale "${locale}". If unsure, use English.`;

  const imageContext = lookImageBase64
    ? " The attached image shows the actual styled look — use its mood, color palette, setting, and overall vibe to inspire your copy."
    : "";

  const prompt = `You are a luxury fashion copywriter. Given the following products that form a coordinated look/collection${imageContext}, generate:

1. A short, evocative TITLE (max 60 characters) — creative, memorable, not generic. No quotes around it. IMPORTANT: Vary your vocabulary — avoid overused fashion words like "effortless", "ethereal", "elevated", "curated", "timeless". Be original.
2. A DESCRIPTION (2-4 sentences) — emotional, editorial-style copy that paints a mood and lifestyle, weaving in the products naturally. Make it feel like a fashion magazine editorial caption.

Products:
${productSummary}

${langInstruction}

IMPORTANT: Respond in EXACTLY this JSON format, nothing else:
{"title": "Your Title Here", "description": "Your description here as plain text."}`;

  // Build parts: text + optional image
  const parts: any[] = [{ text: prompt }];
  if (lookImageBase64) {
    parts.push({
      inline_data: {
        mime_type: "image/png",
        data: lookImageBase64,
      },
    });
  }

  const response = await fetch(`${GEMINI_TEXT_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 500,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[VUAL Copywriting] Gemini error:", errorText);
    return fallbackCopy(products);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || fallbackTitle(products),
        descriptionHtml: `<p>${escapeHtml(parsed.description || "")}</p>`,
      };
    }
  } catch (e) {
    console.error("[VUAL Copywriting] Parse error:", e, "Raw:", text);
  }

  return fallbackCopy(products);
}

function fallbackTitle(products: ProductInfo[]): string {
  const date = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `VUAL Look — ${date}`;
}

function fallbackCopy(products: ProductInfo[]): CopywritingResult {
  const names = products.map((p) => p.title).join(", ");
  return {
    title: fallbackTitle(products),
    descriptionHtml: `<p>A curated look featuring ${names}.</p>`,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
