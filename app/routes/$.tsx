import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.error(`[404 CatchAll] ${request.method} ${url.pathname}${url.search}`);
  throw json({ message: "Page not found", path: url.pathname }, { status: 404 });
};

export default function CatchAll() {
  return null;
}
