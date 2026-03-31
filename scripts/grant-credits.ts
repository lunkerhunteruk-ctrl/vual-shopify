/**
 * Grant credits to a specific shop
 *
 * Usage:
 *   npx tsx scripts/grant-credits.ts <shop_domain> <credits> [reason]
 *
 * Examples:
 *   npx tsx scripts/grant-credits.ts cool-brand.myshopify.com 100 "Case study permission"
 *   npx tsx scripts/grant-credits.ts fashion-store.myshopify.com 50 "Beta tester bonus"
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  const [, , shopDomain, creditsStr, reason] = process.argv;

  if (!shopDomain || !creditsStr) {
    console.error("Usage: npx tsx scripts/grant-credits.ts <shop_domain> <credits> [reason]");
    console.error("Example: npx tsx scripts/grant-credits.ts cool-brand.myshopify.com 100 \"Case study\"");
    process.exit(1);
  }

  const credits = parseInt(creditsStr, 10);
  if (isNaN(credits) || credits <= 0) {
    console.error("Credits must be a positive number");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Find active subscription
  const { data: sub, error: subErr } = await supabase
    .from("shopify_subscriptions")
    .select("*")
    .eq("shop_domain", shopDomain)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (subErr || !sub) {
    console.error(`No active subscription found for ${shopDomain}`);
    process.exit(1);
  }

  const newMonthlyCredits = sub.monthly_credits + credits;

  // Update
  const { error: updateErr } = await supabase
    .from("shopify_subscriptions")
    .update({
      monthly_credits: newMonthlyCredits,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  if (updateErr) {
    console.error("Failed to update:", updateErr.message);
    process.exit(1);
  }

  // Log
  await supabase.from("shopify_credit_usage").insert({
    subscription_id: sub.id,
    shop_domain: shopDomain,
    credits: -credits, // negative = granted
    description: `ADMIN GRANT: ${reason || "Manual credit grant"}`,
    is_overage: false,
    overage_amount_usd: 0,
  });

  console.log(`✓ Granted ${credits} credits to ${shopDomain}`);
  console.log(`  Plan: ${sub.plan_key}`);
  console.log(`  Credits: ${sub.monthly_credits} → ${newMonthlyCredits}`);
  console.log(`  Used: ${sub.credits_used} / ${newMonthlyCredits}`);
  console.log(`  Reason: ${reason || "Manual credit grant"}`);
}

main();
