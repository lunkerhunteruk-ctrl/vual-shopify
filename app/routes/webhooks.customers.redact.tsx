import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Mandatory compliance webhook: customers/redact
 *
 * Shopify sends this when a store owner requests deletion of customer data.
 * VUAL only stores customer IP addresses temporarily in shopify_credit_usage
 * for daily rate limiting. These are not linked to customer accounts and
 * are automatically purged. We acknowledge the request.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  return new Response();
};
