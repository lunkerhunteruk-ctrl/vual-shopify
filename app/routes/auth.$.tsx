import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch (error) {
    // Rethrow Response objects (redirects, auth challenges)
    if (error instanceof Response) throw error;
    console.error("Auth error:", error);
    throw new Response("Authentication failed", { status: 401 });
  }
  return null;
};
