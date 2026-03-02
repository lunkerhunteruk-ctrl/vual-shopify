import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Mandatory compliance webhook: customers/data_request
 *
 * Shopify sends this when a customer requests their data.
 * VUAL stores minimal customer data (only IP addresses in
 * shopify_credit_usage for rate limiting, auto-deleted after 30 days).
 * We acknowledge the request — no customer PII is stored long-term.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  return new Response();
};
