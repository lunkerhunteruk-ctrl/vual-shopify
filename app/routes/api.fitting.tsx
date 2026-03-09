/**
 * VUAL Fitting — App Proxy Endpoint
 *
 * Receives virtual try-on requests from the storefront Theme App Extension
 * via Shopify App Proxy (/apps/vual-fitting → /api/fitting).
 *
 * Supports coordinate try-on: multiple garments in a single generation.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  consumeCredit,
  checkCustomerDailyLimit,
  getFittingEnabled,
} from "../../lib/billing/credit-tracker.server";
import {
  generateVTON,
  imageUrlToBase64,
} from "../../lib/ai/vertex-vton.server";
import { addWatermark } from "../../lib/ai/watermark.server";

const FITTING_CREDIT_COST = 1; // 1 point per try-on (3-point system)

// CORS headers for storefront requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// OPTIONS for CORS preflight
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // App Proxy GET
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (!session) {
      return json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // Status check for storefront extension
    const url = new URL(request.url);
    if (url.searchParams.get("check") === "status") {
      const enabled = await getFittingEnabled(session.shop);
      return json({ enabled }, {
        headers: { ...corsHeaders, "Cache-Control": "no-store, no-cache" },
      });
    }

    // Health check
    return json({ ok: true, shop: session.shop }, { headers: corsHeaders });
  } catch {
    return json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // Authenticate via App Proxy HMAC signature
  let session;
  try {
    const result = await authenticate.public.appProxy(request);
    session = result.session;
  } catch {
    return json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401, headers: corsHeaders }
    );
  }

  if (!session) {
    return json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401, headers: corsHeaders }
    );
  }

  const shopDomain = session.shop;

  // Extract customer IP from App Proxy forwarded headers
  const customerIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // Check customer daily limit before processing
  const dailyLimit = await checkCustomerDailyLimit(shopDomain, customerIp);
  if (!dailyLimit.allowed) {
    return json(
      {
        success: false,
        error: "DAILY_LIMIT_REACHED",
        message: "Daily try-on limit reached. Please try again tomorrow.",
        dailyUsed: dailyLimit.used,
        dailyLimit: dailyLimit.limit,
        dailyRemaining: 0,
      },
      { status: 429, headers: corsHeaders }
    );
  }

  // Parse request body — supports both single and multi-garment
  let body: {
    personImage?: string;
    garmentImageUrl?: string; // legacy single
    garmentImageUrls?: string[]; // multi-garment
    category?: string; // legacy single
    categories?: string[]; // multi-garment
    modelSettings?: { gender?: string; height?: number };
  };
  try {
    body = await request.json();
  } catch {
    return json(
      { success: false, error: "INVALID_BODY", message: "Invalid JSON body" },
      { status: 400, headers: corsHeaders }
    );
  }

  const { personImage } = body;

  // Normalize to arrays (backward compatible)
  const garmentUrls: string[] = body.garmentImageUrls
    || (body.garmentImageUrl ? [body.garmentImageUrl] : []);
  const categories: string[] = body.categories
    || (body.category ? [body.category] : []);

  if (!personImage || garmentUrls.length === 0) {
    return json(
      {
        success: false,
        error: "MISSING_FIELDS",
        message: "personImage and at least one garment image URL are required",
      },
      { status: 400, headers: corsHeaders }
    );
  }

  // Limit to 5 garments
  if (garmentUrls.length > 5) {
    return json(
      {
        success: false,
        error: "TOO_MANY_ITEMS",
        message: "Maximum 5 garments per generation",
      },
      { status: 400, headers: corsHeaders }
    );
  }

  // Consume 1 point per generation (regardless of garment count)
  const creditResult = await consumeCredit(
    shopDomain,
    "Virtual try-on fitting",
    FITTING_CREDIT_COST,
    customerIp
  );
  if (!creditResult.allowed) {
    return json(
      {
        success: false,
        error: "NO_CREDITS",
        message: "No points remaining. Please upgrade your plan.",
      },
      { headers: corsHeaders }
    );
  }

  try {
    // Convert all garment URLs to base64 in parallel
    const garmentBase64s = await Promise.all(
      garmentUrls.map((url) => imageUrlToBase64(url))
    );

    const garmentDataUrls = garmentBase64s.map(
      (b64) => `data:image/jpeg;base64,${b64}`
    );

    // Fill categories array to match garment count
    const filledCategories = garmentUrls.map(
      (_, i) => categories[i] || "upper_body"
    );

    // Call VTON engine — all garments in one generation
    const result = await generateVTON({
      personImage,
      garmentImages: garmentDataUrls,
      categories: filledCategories,
      modelSettings: body.modelSettings,
    });

    // Add watermark with shop name
    const watermarkedImage = await addWatermark(
      result.resultImage,
      shopDomain.replace(".myshopify.com", "")
    );

    return json(
      {
        success: true,
        resultImage: watermarkedImage,
        processingTime: result.processingTime,
        dailyRemaining: dailyLimit.remaining - 1,
        dailyLimit: dailyLimit.limit,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[VUAL Fitting] Generation error:", error);
    return json(
      {
        success: false,
        error: "GENERATION_FAILED",
        message:
          error instanceof Error ? error.message : "Generation failed",
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
