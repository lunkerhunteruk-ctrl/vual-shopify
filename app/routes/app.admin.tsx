import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Badge,
  Banner,
  DataTable,
  Divider,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSupabase } from "../../lib/supabase.server";

// Only allow your own shop to access this page
const ADMIN_SHOPS = ["vual-dev.myshopify.com"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // For dev, allow all shops; in production, restrict to ADMIN_SHOPS
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev && !ADMIN_SHOPS.includes(session.shop)) {
    return json({ authorized: false, shops: [] });
  }

  const supabase = getSupabase() as any;
  const { data: shops } = await supabase
    .from("shopify_subscriptions")
    .select("*")
    .order("created_at", { ascending: false });

  return json({ authorized: true, shops: shops || [] });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev && !ADMIN_SHOPS.includes(session.shop)) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const supabase = getSupabase() as any;

  if (intent === "grantCredits") {
    const shopDomain = formData.get("shopDomain") as string;
    const credits = parseInt(formData.get("credits") as string, 10);
    const reason = (formData.get("reason") as string) || "Admin grant";

    if (!shopDomain || isNaN(credits) || credits <= 0) {
      return json({ error: "Invalid shop or credits" }, { status: 400 });
    }

    const { data: sub } = await supabase
      .from("shopify_subscriptions")
      .select("*")
      .eq("shop_domain", shopDomain)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!sub) {
      return json({ error: `No active subscription for ${shopDomain}` }, { status: 404 });
    }

    const newCredits = sub.monthly_credits + credits;
    await supabase
      .from("shopify_subscriptions")
      .update({ monthly_credits: newCredits, updated_at: new Date().toISOString() })
      .eq("id", sub.id);

    await supabase.from("shopify_credit_usage").insert({
      subscription_id: sub.id,
      shop_domain: shopDomain,
      credits: -credits,
      description: `ADMIN: ${reason}`,
      is_overage: false,
      overage_amount_usd: 0,
    });

    return json({
      success: true,
      message: `Granted ${credits} credits to ${shopDomain} (${sub.monthly_credits} → ${newCredits})`,
    });
  }

  if (intent === "resetCredits") {
    const subId = formData.get("subId") as string;

    await supabase
      .from("shopify_subscriptions")
      .update({ credits_used: 0, updated_at: new Date().toISOString() })
      .eq("id", subId);

    return json({ success: true, message: "Credits reset to 0" });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function AdminPage() {
  const { authorized, shops } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const lastDataRef = useRef<any>(null);

  const [grantShop, setGrantShop] = useState("");
  const [grantAmount, setGrantAmount] = useState("50");
  const [grantReason, setGrantReason] = useState("");

  useEffect(() => {
    const data = fetcher.data as any;
    if (!data || data === lastDataRef.current) return;
    lastDataRef.current = data;
    if (data.success) shopify.toast.show(data.message);
    if (data.error) shopify.toast.show(data.error, { isError: true });
  }, [fetcher.data, shopify]);

  const handleGrant = useCallback(() => {
    if (!grantShop || !grantAmount) return;
    const formData = new FormData();
    formData.set("intent", "grantCredits");
    formData.set("shopDomain", grantShop);
    formData.set("credits", grantAmount);
    formData.set("reason", grantReason);
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, grantShop, grantAmount, grantReason]);

  const handleReset = useCallback(
    (subId: string, shopDomain: string) => {
      if (!confirm(`Reset credits_used to 0 for ${shopDomain}?`)) return;
      const formData = new FormData();
      formData.set("intent", "resetCredits");
      formData.set("subId", subId);
      fetcher.submit(formData, { method: "POST" });
    },
    [fetcher]
  );

  if (!authorized) {
    return (
      <Page title="Admin">
        <Banner tone="critical">Unauthorized</Banner>
      </Page>
    );
  }

  const isSubmitting = fetcher.state !== "idle";

  const rows = shops.map((s: any) => [
    s.shop_domain,
    s.plan_key,
    `${s.credits_used} / ${s.monthly_credits}`,
    s.status,
    new Date(s.created_at).toLocaleDateString(),
    <InlineStack key={s.id} gap="200">
      <Button
        size="slim"
        onClick={() => setGrantShop(s.shop_domain)}
      >
        Grant
      </Button>
      <Button
        size="slim"
        tone="critical"
        onClick={() => handleReset(s.id, s.shop_domain)}
      >
        Reset
      </Button>
    </InlineStack>,
  ]);

  return (
    <Page backAction={{ url: "/app" }} title="Admin — Shop Management">
      <TitleBar title="Admin" />
      <BlockStack gap="500">
        {/* Grant Credits */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Grant Credits</Text>
            <InlineStack gap="300" blockAlign="end" wrap={false}>
              <div style={{ flex: 2 }}>
                <TextField
                  label="Shop domain"
                  value={grantShop}
                  onChange={setGrantShop}
                  placeholder="cool-brand.myshopify.com"
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Credits"
                  type="number"
                  value={grantAmount}
                  onChange={setGrantAmount}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 2 }}>
                <TextField
                  label="Reason"
                  value={grantReason}
                  onChange={setGrantReason}
                  placeholder="Case study permission"
                  autoComplete="off"
                />
              </div>
              <Button
                variant="primary"
                onClick={handleGrant}
                loading={isSubmitting}
                disabled={!grantShop || !grantAmount}
              >
                Grant
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* All Shops */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">All Shops</Text>
              <Badge>{shops.length} total</Badge>
            </InlineStack>
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text"]}
              headings={["Shop", "Plan", "Credits", "Status", "Created", "Actions"]}
              rows={rows}
            />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
