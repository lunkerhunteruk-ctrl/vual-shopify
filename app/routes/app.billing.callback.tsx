import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getPlanByKey } from "../../lib/billing/plans.server";
import {
  getActiveSubscription,
} from "../../lib/billing/shopify-billing.server";
import {
  activateSubscription,
} from "../../lib/billing/credit-tracker.server";

/**
 * Callback after merchant approves/declines subscription on Shopify.
 * URL: /app/billing/callback?planKey=starter&charge_id=xxx
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const planKey = url.searchParams.get("planKey");

  if (!planKey) {
    return redirect("/app/billing");
  }

  const plan = getPlanByKey(planKey);
  if (!plan) {
    return redirect("/app/billing");
  }

  // Verify the subscription is now active on Shopify's side
  const activeSub = await getActiveSubscription(admin);

  if (activeSub && activeSub.name === plan.shopifyPlanName) {
    // Subscription approved — activate in our system
    await activateSubscription(
      session.shop,
      plan.key,
      activeSub.id,
      plan.monthlyCredits,
      plan.overageUsd
    );
  }

  // Redirect back to billing page (shows updated status)
  return redirect("/app/billing");
};
