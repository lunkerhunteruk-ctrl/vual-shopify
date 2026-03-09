/**
 * VUAL Studio + Fitting — Billing Plans (3-point system)
 *
 * Point costs:
 *   Studio generation = 3 pt
 *   Virtual Try-On    = 1 pt
 *
 * Pricing (USD-based, Shopify Billing API):
 *   Free Trial: 15 pt one-time   (5 Studio / 15 VTON)
 *   Starter:    $29/mo → 150 pt  (50 Studio / 150 VTON)
 *   Growth:     $79/mo → 600 pt  (200 Studio / 600 VTON)
 *   Pro:        $299/mo → 3,000 pt (1,000 Studio / 3,000 VTON)
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
    oneTimeCredits: 15,
    isFree: true,
    shopifyPlanName: "VUAL Free Trial",
    features: [
      "15 points (5 Studio or 15 Try-Ons)",
      "AI copywriting",
      "Save to products",
      "Create collections",
    ],
  },
  starter: {
    key: "starter",
    name: "Starter",
    priceUsd: 29,
    monthlyCredits: 150,
    overageUsd: 0.8 / 3, // $0.80 per 3pt (Studio generation), ~$0.267 per pt
    isFree: false,
    shopifyPlanName: "VUAL Starter",
    features: [
      "150 points/month",
      "Studio: 3 pt (= 50 generations)",
      "Try-On: 1 pt (= 150 try-ons)",
      "AI copywriting",
      "Save to products",
      "Create collections",
      "Overage: $0.80/3 pt",
    ],
  },
  growth: {
    key: "growth",
    name: "Growth",
    priceUsd: 79,
    monthlyCredits: 600,
    overageUsd: 0.5 / 3, // $0.50 per 3pt (Studio generation), ~$0.167 per pt
    isFree: false,
    shopifyPlanName: "VUAL Growth",
    features: [
      "600 points/month",
      "Studio: 3 pt (= 200 generations)",
      "Try-On: 1 pt (= 600 try-ons)",
      "AI copywriting",
      "Save to products",
      "Create collections",
      "Overage: $0.50/3 pt",
    ],
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceUsd: 299,
    monthlyCredits: 3000,
    overageUsd: 0.25 / 3, // $0.25 per 3pt (Studio generation), ~$0.083 per pt
    isFree: false,
    shopifyPlanName: "VUAL Pro",
    features: [
      "3,000 points/month",
      "Studio: 3 pt (= 1,000 generations)",
      "Try-On: 1 pt (= 3,000 try-ons)",
      "AI copywriting",
      "Save to products",
      "Create collections",
      "Overage: $0.25/3 pt",
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
