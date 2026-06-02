import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Mandatory compliance webhook: shop/redact
 *
 * Shopify sends this 48 hours after an app is uninstalled, requesting
 * deletion of all shop data. We remove the shop's subscription and
 * usage records from Supabase.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "unknown";
  try {
    const result = await authenticate.webhook(request);
    shop = result.shop;
    console.log(`Received ${result.topic} webhook for ${shop}`);

    const { getSupabase } = await import("../../lib/supabase.server");
    const supabase = getSupabase() as any;

    // Delete credit usage logs
    await supabase
      .from("shopify_credit_usage")
      .delete()
      .eq("shop_domain", shop);

    // Delete subscription records
    await supabase
      .from("shopify_subscriptions")
      .delete()
      .eq("shop_domain", shop);

    console.log(`Shop data redacted for ${shop}`);
  } catch (error) {
    // Re-throw auth Response errors (HMAC validation failures etc.)
    if (error instanceof Response) throw error;
    console.error(`Failed to redact shop data for ${shop}:`, error);
  }

  return new Response("OK", { status: 200 });
};
