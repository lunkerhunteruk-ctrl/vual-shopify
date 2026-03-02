import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getPlanByShopifyName } from "../../lib/billing/plans.server";
import {
  activateSubscription,
  cancelShopSubscription,
} from "../../lib/billing/credit-tracker.server";

/**
 * Webhook: app_subscriptions/update
 *
 * Fired when a subscription is activated, declined, expired, or cancelled.
 * Keeps our Supabase subscription record in sync with Shopify.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  console.log(
    `[Webhook] app_subscriptions/update for ${shop}:`,
    JSON.stringify(payload, null, 2)
  );

  const subscription = payload.app_subscription;
  if (!subscription) {
    return new Response("OK", { status: 200 });
  }

  const status = subscription.status;
  const name = subscription.name;
  const shopifySubId = subscription.admin_graphql_api_id;

  if (status === "ACTIVE") {
    // Subscription activated (or re-activated)
    const plan = getPlanByShopifyName(name);
    if (plan) {
      await activateSubscription(
        shop,
        plan.key,
        shopifySubId,
        plan.monthlyCredits,
        plan.overageUsd
      );
      console.log(`[Webhook] Activated ${plan.key} for ${shop}`);
    }
  } else if (
    status === "CANCELLED" ||
    status === "DECLINED" ||
    status === "EXPIRED"
  ) {
    await cancelShopSubscription(shop);
    console.log(`[Webhook] Cancelled subscription for ${shop} (${status})`);
  }

  return new Response("OK", { status: 200 });
};
