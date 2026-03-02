/**
 * Credit Tracker — Supabase-backed credit management
 *
 * Tables used (in shared Supabase):
 *   shopify_subscriptions — tracks shop plan & billing cycle
 *   shopify_credit_usage  — per-generation credit log
 */

import { getSupabase } from "../supabase.server";

// Use untyped client since these tables aren't in generated Supabase types yet
function db() {
  return getSupabase() as any;
}

// ---- Types ----

export interface ShopSubscription {
  id: string;
  shop_domain: string;
  plan_key: string;
  shopify_subscription_id: string | null;
  monthly_credits: number;
  overage_usd: number;
  credits_used: number;
  billing_cycle_start: string;
  billing_cycle_end: string | null;
  daily_customer_limit: number;
  fitting_enabled: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreditStatus {
  planKey: string;
  monthlyCredits: number;
  creditsUsed: number;
  creditsRemaining: number;
  overageUsd: number;
  overageCreditsUsed: number;
  billingCycleStart: string;
  billingCycleEnd: string | null;
  canGenerate: boolean;
}

// ---- Functions ----

/**
 * Get or create subscription record for a shop
 */
export async function getShopSubscription(
  shopDomain: string
): Promise<ShopSubscription | null> {
  const { data, error } = await db()
    .from("shopify_subscriptions")
    .select("*")
    .eq("shop_domain", shopDomain)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as ShopSubscription;
}

/**
 * Initialize a free trial for a new shop
 */
export async function initializeFreeTrial(
  shopDomain: string
): Promise<ShopSubscription> {
  // Check if already has any subscription
  const { data: existing } = await db()
    .from("shopify_subscriptions")
    .select("id")
    .eq("shop_domain", shopDomain)
    .limit(1);

  if (existing && existing.length > 0) {
    // Return existing (even if expired, don't grant new trial)
    const sub = await getShopSubscription(shopDomain);
    if (sub) return sub;
  }

  const now = new Date();
  const { data, error } = await db()
    .from("shopify_subscriptions")
    .insert({
      shop_domain: shopDomain,
      plan_key: "free",
      shopify_subscription_id: null,
      monthly_credits: 5, // one-time
      overage_usd: 0,
      credits_used: 0,
      daily_customer_limit: 5,
      billing_cycle_start: now.toISOString(),
      billing_cycle_end: null, // no expiry for free tier
      status: "active",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create free trial: ${error.message}`);
  return data as ShopSubscription;
}

/**
 * Activate or upgrade a paid subscription
 */
export async function activateSubscription(
  shopDomain: string,
  planKey: string,
  shopifySubscriptionId: string,
  monthlyCredits: number,
  overageUsd: number
): Promise<ShopSubscription> {
  // Read existing settings before deactivating
  const existingSub = await getShopSubscription(shopDomain);
  const fittingEnabled = existingSub?.fitting_enabled ?? true;

  // Deactivate any existing subscription
  await db()
    .from("shopify_subscriptions")
    .update({ status: "cancelled" })
    .eq("shop_domain", shopDomain)
    .eq("status", "active");

  const now = new Date();
  const cycleEnd = new Date(now);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);

  const { data, error } = await db()
    .from("shopify_subscriptions")
    .insert({
      shop_domain: shopDomain,
      plan_key: planKey,
      shopify_subscription_id: shopifySubscriptionId,
      monthly_credits: monthlyCredits,
      overage_usd: overageUsd,
      credits_used: 0,
      fitting_enabled: fittingEnabled,
      billing_cycle_start: now.toISOString(),
      billing_cycle_end: cycleEnd.toISOString(),
      status: "active",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to activate subscription: ${error.message}`);
  return data as ShopSubscription;
}

/**
 * Get credit status for a shop
 */
export async function getCreditStatus(
  shopDomain: string
): Promise<CreditStatus> {
  let sub = await getShopSubscription(shopDomain);

  // Auto-initialize free trial if no subscription exists
  if (!sub) {
    sub = await initializeFreeTrial(shopDomain);
  }

  // Check if billing cycle has expired (for paid plans) and reset
  if (sub.billing_cycle_end) {
    const cycleEnd = new Date(sub.billing_cycle_end);
    if (new Date() > cycleEnd) {
      await resetBillingCycle(sub.id);
      sub = (await getShopSubscription(shopDomain))!;
    }
  }

  const creditsRemaining = Math.max(0, sub.monthly_credits - sub.credits_used);
  const overageCreditsUsed = Math.max(0, sub.credits_used - sub.monthly_credits);

  // Can generate if: has remaining credits OR has overage pricing
  const canGenerate = creditsRemaining > 0 || sub.overage_usd > 0;

  return {
    planKey: sub.plan_key,
    monthlyCredits: sub.monthly_credits,
    creditsUsed: sub.credits_used,
    creditsRemaining,
    overageUsd: sub.overage_usd,
    overageCreditsUsed,
    billingCycleStart: sub.billing_cycle_start,
    billingCycleEnd: sub.billing_cycle_end,
    canGenerate,
  };
}

/**
 * Consume credits. Returns true if allowed, false if blocked.
 * @param amount — credits to consume (default 1, use 0.5 for fitting)
 */
export async function consumeCredit(
  shopDomain: string,
  description: string = "AI look generation",
  amount: number = 1,
  customerIp: string = ""
): Promise<{
  allowed: boolean;
  isOverage: boolean;
  overageAmount: number;
  creditsRemaining: number;
}> {
  const sub = await getShopSubscription(shopDomain);
  if (!sub) {
    return { allowed: false, isOverage: false, overageAmount: 0, creditsRemaining: 0 };
  }

  const newUsed = sub.credits_used + amount;
  const isOverage = newUsed > sub.monthly_credits;

  // Block if no credits left AND no overage pricing
  if (isOverage && sub.overage_usd <= 0) {
    return {
      allowed: false,
      isOverage: true,
      overageAmount: 0,
      creditsRemaining: 0,
    };
  }

  // Increment usage
  await db()
    .from("shopify_subscriptions")
    .update({ credits_used: newUsed, updated_at: new Date().toISOString() })
    .eq("id", sub.id);

  // Log usage
  await db().from("shopify_credit_usage").insert({
    subscription_id: sub.id,
    shop_domain: shopDomain,
    credits: amount,
    description,
    is_overage: isOverage,
    overage_amount_usd: isOverage ? sub.overage_usd * amount : 0,
    customer_ip: customerIp || null,
  });

  const creditsRemaining = Math.max(0, sub.monthly_credits - newUsed);

  return {
    allowed: true,
    isOverage,
    overageAmount: isOverage ? sub.overage_usd * amount : 0,
    creditsRemaining,
  };
}

/**
 * Reset billing cycle (called when cycle expires)
 */
async function resetBillingCycle(subscriptionId: string): Promise<void> {
  const now = new Date();
  const cycleEnd = new Date(now);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);

  await db()
    .from("shopify_subscriptions")
    .update({
      credits_used: 0,
      billing_cycle_start: now.toISOString(),
      billing_cycle_end: cycleEnd.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", subscriptionId);
}

/**
 * Cancel subscription for a shop
 */
export async function cancelShopSubscription(
  shopDomain: string
): Promise<void> {
  await db()
    .from("shopify_subscriptions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("shop_domain", shopDomain)
    .eq("status", "active");
}

// ---- Customer Daily Limit ----

/**
 * Check if a customer (by IP) has exceeded their daily fitting limit.
 * Returns { allowed, used, limit, remaining }.
 */
export async function checkCustomerDailyLimit(
  shopDomain: string,
  customerIp: string
): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}> {
  const sub = await getShopSubscription(shopDomain);
  const limit = sub?.daily_customer_limit ?? 5;

  // Count today's fitting usage for this IP
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count, error } = await db()
    .from("shopify_credit_usage")
    .select("*", { count: "exact", head: true })
    .eq("shop_domain", shopDomain)
    .eq("customer_ip", customerIp)
    .gte("created_at", todayStart.toISOString());

  const used = error ? 0 : (count || 0);
  const remaining = Math.max(0, limit - used);

  return {
    allowed: used < limit,
    used,
    limit,
    remaining,
  };
}

/**
 * Update the daily customer limit for a shop
 */
export async function updateDailyCustomerLimit(
  shopDomain: string,
  limit: number
): Promise<void> {
  await db()
    .from("shopify_subscriptions")
    .update({
      daily_customer_limit: limit,
      updated_at: new Date().toISOString(),
    })
    .eq("shop_domain", shopDomain)
    .eq("status", "active");
}

// ---- Fitting Enabled Toggle ----

/**
 * Get whether virtual try-on is enabled for a shop.
 */
export async function getFittingEnabled(
  shopDomain: string
): Promise<boolean> {
  const sub = await getShopSubscription(shopDomain);
  return sub?.fitting_enabled ?? true;
}

/**
 * Update the fitting_enabled flag for a shop.
 */
export async function updateFittingEnabled(
  shopDomain: string,
  enabled: boolean
): Promise<void> {
  await db()
    .from("shopify_subscriptions")
    .update({
      fitting_enabled: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("shop_domain", shopDomain)
    .eq("status", "active");
}
