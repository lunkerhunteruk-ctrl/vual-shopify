/**
 * Shopify Billing API integration
 *
 * Uses Shopify GraphQL Admin API to create/manage recurring subscriptions
 * and usage-based charges (overage).
 */

import type { BillingPlan } from "./plans.server";

// ---- Types ----

interface ShopifyAdmin {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
}

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  currentPeriodEnd: string | null;
  createdAt: string;
  lineItems: {
    id: string;
    plan: {
      pricingDetails: {
        __typename: string;
        price?: { amount: string; currencyCode: string };
        balanceUsed?: { amount: string; currencyCode: string };
        cappedAmount?: { amount: string; currencyCode: string };
        terms?: string;
      };
    };
  }[];
}

// ---- Queries ----

const ACTIVE_SUBSCRIPTIONS_QUERY = `
  query {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        createdAt
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                price { amount currencyCode }
              }
              ... on AppUsagePricing {
                balanceUsed { amount currencyCode }
                cappedAmount { amount currencyCode }
                terms
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_SUBSCRIPTION_MUTATION = `
  mutation appSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $test: Boolean
    $trialDays: Int
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: $lineItems
      test: $test
      trialDays: $trialDays
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = `
  mutation appSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CREATE_USAGE_CHARGE_MUTATION = `
  mutation appUsageRecordCreate(
    $subscriptionLineItemId: ID!
    $price: MoneyInput!
    $description: String!
  ) {
    appUsageRecordCreate(
      subscriptionLineItemId: $subscriptionLineItemId
      price: $price
      description: $description
    ) {
      appUsageRecord {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ---- Functions ----

/**
 * Get the active subscription for the current shop
 */
export async function getActiveSubscription(
  admin: ShopifyAdmin
): Promise<ActiveSubscription | null> {
  const res = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
  const data = await res.json();
  const subs =
    data.data?.currentAppInstallation?.activeSubscriptions || [];

  // Return the first active one (there should be at most 1)
  return subs.length > 0 ? subs[0] : null;
}

/**
 * Create a new subscription (redirects merchant to Shopify approval page)
 */
export async function createSubscription(
  admin: ShopifyAdmin,
  plan: BillingPlan,
  returnUrl: string,
  isTest: boolean = false
): Promise<{ confirmationUrl: string | null; error: string | null }> {
  const lineItems: any[] = [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: plan.priceUsd, currencyCode: "USD" },
        },
      },
    },
  ];

  // Add usage-based line item for overage charges
  if (plan.overageUsd > 0) {
    // Cap overage at 10x the monthly price
    const cappedAmount = Math.max(plan.priceUsd * 10, 100);
    lineItems.push({
      plan: {
        appUsagePricingDetails: {
          terms: `Overage: $${plan.overageUsd.toFixed(2)}/credit beyond ${plan.monthlyCredits} included credits`,
          cappedAmount: { amount: cappedAmount, currencyCode: "USD" },
        },
      },
    });
  }

  const res = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
    variables: {
      name: plan.shopifyPlanName,
      returnUrl,
      lineItems,
      test: isTest,
    },
  });

  const data = await res.json();
  const result = data.data?.appSubscriptionCreate;

  if (result?.userErrors?.length > 0) {
    return {
      confirmationUrl: null,
      error: result.userErrors.map((e: any) => e.message).join(", "),
    };
  }

  return {
    confirmationUrl: result?.confirmationUrl || null,
    error: null,
  };
}

/**
 * Cancel an active subscription
 */
export async function cancelSubscription(
  admin: ShopifyAdmin,
  subscriptionId: string
): Promise<{ success: boolean; error: string | null }> {
  const res = await admin.graphql(CANCEL_SUBSCRIPTION_MUTATION, {
    variables: { id: subscriptionId },
  });

  const data = await res.json();
  const result = data.data?.appSubscriptionCancel;

  if (result?.userErrors?.length > 0) {
    return {
      success: false,
      error: result.userErrors.map((e: any) => e.message).join(", "),
    };
  }

  return { success: true, error: null };
}

/**
 * Create a usage charge for overage
 */
export async function createUsageCharge(
  admin: ShopifyAdmin,
  subscriptionLineItemId: string,
  amount: number,
  description: string
): Promise<{ success: boolean; error: string | null }> {
  const res = await admin.graphql(CREATE_USAGE_CHARGE_MUTATION, {
    variables: {
      subscriptionLineItemId,
      price: { amount, currencyCode: "USD" },
      description,
    },
  });

  const data = await res.json();
  const result = data.data?.appUsageRecordCreate;

  if (result?.userErrors?.length > 0) {
    return {
      success: false,
      error: result.userErrors.map((e: any) => e.message).join(", "),
    };
  }

  return { success: true, error: null };
}

/**
 * Get the usage pricing line item ID from an active subscription
 * (needed for creating usage charges)
 */
export function getUsageLineItemId(
  subscription: ActiveSubscription
): string | null {
  const usageItem = subscription.lineItems.find(
    (li) => li.plan.pricingDetails.__typename === "AppUsagePricing"
  );
  return usageItem?.id || null;
}
