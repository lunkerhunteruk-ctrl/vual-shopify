/**
 * VUAL Studio + Fitting — Billing Plans
 *
 * Pricing (USD-based, Shopify Billing API):
 *   Free Trial: 5 credits one-time
 *   Starter:    $29/mo → 50 credits/mo, $0.80 overage
 *   Growth:     $79/mo → 200 credits/mo, $0.50 overage
 *   Pro:        $199/mo → 1,000 credits/mo, $0.25 overage
 */

export interface BillingPlan {
  /** Internal plan key */
  key: string;
  /** Display name */
  name: string;
  /** Monthly price in USD (0 = free) */
  priceUsd: number;
  /** Credits included per month */
  monthlyCredits: number;
  /** Overage cost per credit in USD (0 = no overage allowed) */
  overageUsd: number;
  /** One-time credits (for free tier, not monthly) */
  oneTimeCredits?: number;
  /** Whether this is the free/trial plan */
  isFree: boolean;
  /** Shopify plan name used in Billing API */
  shopifyPlanName: string;
  /** Features included */
  features: string[];
}

export const BILLING_PLANS: Record<string, BillingPlan> = {
  free: {
    key: "free",
    name: "Free Trial",
    priceUsd: 0,
    monthlyCredits: 0,
    overageUsd: 0,
    oneTimeCredits: 5,
    isFree: true,
    shopifyPlanName: "VUAL Free Trial",
    features: [
      "5 AI look generations (one-time)",
      "AI copywriting",
      "Save to products",
      "Create collections",
    ],
  },
  starter: {
    key: "starter",
    name: "Starter",
    priceUsd: 29,
    monthlyCredits: 50,
    overageUsd: 0.8,
    isFree: false,
    shopifyPlanName: "VUAL Starter",
    features: [
      "50 AI look generations/month",
      "Virtual Try-On: 0.5 credit each (= 100 try-ons)",
      "AI copywriting",
      "Save to products",
      "Create collections",
      "Overage: $0.80/credit",
    ],
  },
  growth: {
    key: "growth",
    name: "Growth",
    priceUsd: 79,
    monthlyCredits: 200,
    overageUsd: 0.5,
    isFree: false,
    shopifyPlanName: "VUAL Growth",
    features: [
      "200 AI look generations/month",
      "Virtual Try-On: 0.5 credit each (= 400 try-ons)",
      "AI copywriting",
      "Save to products",
      "Create collections",
      "Overage: $0.50/credit",
    ],
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceUsd: 199,
    monthlyCredits: 1000,
    overageUsd: 0.25,
    isFree: false,
    shopifyPlanName: "VUAL Pro",
    features: [
      "1,000 AI look generations/month",
      "Virtual Try-On: 0.5 credit each (= 2,000 try-ons)",
      "AI copywriting",
      "Save to products",
      "Create collections",
      "Overage: $0.25/credit",
      "Priority support",
    ],
  },
};

export function getPlanByKey(key: string): BillingPlan | undefined {
  return BILLING_PLANS[key];
}

export function getPlanByShopifyName(name: string): BillingPlan | undefined {
  return Object.values(BILLING_PLANS).find((p) => p.shopifyPlanName === name);
}

export function getAllPlans(): BillingPlan[] {
  return Object.values(BILLING_PLANS);
}
