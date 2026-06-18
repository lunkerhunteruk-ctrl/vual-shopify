/**
 * APIMart API client — Gemini-3.1-Flash-Image-preview (nano-banana-2)
 * Endpoint: https://api.apimart.ai/v1/images/generations
 * Pattern: POST → task_id → poll until completed
 */

const APIMART_BASE = "https://api.apimart.ai";
const MODEL = "gemini-3.1-flash-image-preview";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 80; // 80 * 3s = 4 min max

function getApiKey(): string {
  const key = process.env.APIMART_API_KEY;
  if (!key) throw new Error("APIMART_API_KEY is not configured");
  return key;
}

export interface ApimartSubmitParams {
  prompt: string;
  size?: string;         // "3:4", "16:9", "1:1", etc.
  resolution?: string;   // "1K" | "2K" | "4K"
  n?: number;
  image_urls?: string[]; // base64 data URIs or public HTTPS URLs
  google_search?: boolean;
}

interface PollResult {
  status: "submitted" | "processing" | "completed" | "failed" | string;
  images?: Array<{ url?: string; b64_json?: string }>;
  error?: string;
}

async function submitTask(params: ApimartSubmitParams): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    prompt: params.prompt,
    size: params.size || "3:4",
    resolution: params.resolution || "2K",
    n: params.n || 1,
  };
  if (params.image_urls?.length) body.image_urls = params.image_urls;
  if (params.google_search) body.google_search = true;

  const res = await fetch(`${APIMART_BASE}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APIMart submit ${res.status}: ${text}`);
  }

  const json = await res.json();
  // Response: { code: 200, data: [{ status: "submitted", task_id: "..." }] }
  const taskId: string | undefined =
    json.data?.[0]?.task_id ?? json.data?.task_id ?? json.task_id;

  if (!taskId) {
    throw new Error(`APIMart: no task_id in response: ${JSON.stringify(json)}`);
  }
  return taskId;
}

async function pollTask(taskId: string): Promise<PollResult> {
  const res = await fetch(`${APIMART_BASE}/v1/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APIMart poll ${res.status}: ${text}`);
  }

  const json = await res.json();
  // Log full response to diagnose structure
  console.log(`[APIMart] Poll raw response: ${JSON.stringify(json)}`);

  // Handle both { data: { status, images } } and { data: [{ status, images }] }
  const inner = Array.isArray(json.data) ? json.data[0] : json.data;

  // images may be under different keys: images / output / result / urls
  const images =
    inner?.images ??
    inner?.output ??
    inner?.result ??
    inner?.urls ??
    json.images ??
    json.output ??
    [];

  return {
    status: inner?.status ?? json.status ?? "unknown",
    images: Array.isArray(images) ? images : [images],
    error: inner?.error ?? json.error,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submit an image generation task and poll until completed.
 * Returns an array of base64 data URLs (data:image/...;base64,...).
 */
export async function generateImages(
  params: ApimartSubmitParams
): Promise<string[]> {
  const taskId = await submitTask(params);
  console.log(`[APIMart] Submitted task: ${taskId}`);

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const result = await pollTask(taskId);
    console.log(`[APIMart] Poll ${i + 1}/${MAX_POLL_ATTEMPTS}: ${result.status}`);

    if (result.status === "completed") {
      const dataUrls: string[] = [];
      for (const img of result.images ?? []) {
        if (img.b64_json) {
          dataUrls.push(`data:image/png;base64,${img.b64_json}`);
        } else if (img.url) {
          // Download the CDN image and convert to base64 data URL
          const imgRes = await fetch(img.url);
          const buf = await imgRes.arrayBuffer();
          const b64 = Buffer.from(buf).toString("base64");
          const ct = imgRes.headers.get("content-type") || "image/png";
          dataUrls.push(`data:${ct};base64,${b64}`);
        }
      }
      if (dataUrls.length === 0) {
        throw new Error(`APIMart task completed but returned no images`);
      }
      return dataUrls;
    }

    if (result.status === "failed") {
      throw new Error(`APIMart task failed: ${result.error ?? "unknown"}`);
    }
  }

  throw new Error(
    `APIMart task timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`
  );
}
