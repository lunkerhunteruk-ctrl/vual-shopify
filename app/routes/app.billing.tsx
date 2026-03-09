import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  Box,
  ProgressBar,
  Divider,
  List,
  TextField,
  Checkbox,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getAllPlans, getPlanByKey } from "../../lib/billing/plans.server";
import {
  getActiveSubscription,
  createSubscription,
  cancelSubscription,
} from "../../lib/billing/shopify-billing.server";
import {
  getCreditStatus,
  getShopSubscription,
  updateDailyCustomerLimit,
  updateFittingEnabled,
} from "../../lib/billing/credit-tracker.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get current subscription & credit status in parallel
  const [activeSubscription, creditStatus, shopSubscription] = await Promise.all([
    getActiveSubscription(admin),
    getCreditStatus(shopDomain),
    getShopSubscription(shopDomain),
  ]);

  const plans = getAllPlans();
  const isDevStore =
    shopDomain.includes(".myshopify.com") &&
    (shopDomain.includes("dev-") || process.env.NODE_ENV === "development");

  const currentPlanName = getPlanByKey(creditStatus.planKey)?.name || creditStatus.planKey;

  return json({
    plans,
    creditStatus,
    activeSubscription,
    shopDomain,
    isDevStore,
    currentPlanName,
    dailyCustomerLimit: shopSubscription?.daily_customer_limit ?? 5,
    fittingEnabled: shopSubscription?.fitting_enabled ?? true,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "subscribe") {
    const planKey = formData.get("planKey") as string;
    const plan = getPlanByKey(planKey);
    if (!plan || plan.isFree) {
      return json({ error: "Invalid plan" }, { status: 400 });
    }

    const isTest =
      session.shop.includes("dev-") ||
      process.env.NODE_ENV === "development";

    const url = new URL(request.url);
    const returnUrl = `${url.origin}/app/billing/callback?planKey=${planKey}`;

    const result = await createSubscription(admin, plan, returnUrl, isTest);

    if (result.error) {
      return json({ error: result.error }, { status: 400 });
    }

    if (result.confirmationUrl) {
      return redirect(result.confirmationUrl);
    }

    return json({ error: "Failed to create subscription" }, { status: 500 });
  }

  if (intent === "toggleFitting") {
    const enabled = formData.get("fittingEnabled") === "true";
    await updateFittingEnabled(session.shop, enabled);
    return json({ success: true, fittingToggled: true, fittingEnabled: enabled });
  }

  if (intent === "updateDailyLimit") {
    const limit = parseInt(formData.get("dailyLimit") as string, 10);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return json({ error: "Daily limit must be between 1 and 100" }, { status: 400 });
    }
    await updateDailyCustomerLimit(session.shop, limit);
    return json({ success: true, dailyLimitUpdated: true });
  }

  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId") as string;
    if (!subscriptionId) {
      return json({ error: "No subscription ID" }, { status: 400 });
    }

    const result = await cancelSubscription(admin, subscriptionId);
    if (!result.success) {
      return json({ error: result.error }, { status: 400 });
    }

    // Cancel in our tracking too
    const { cancelShopSubscription } = await import(
      "../../lib/billing/credit-tracker.server"
    );
    await cancelShopSubscription(session.shop);

    return json({ success: true, cancelled: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function BillingPage() {
  const {
    plans,
    creditStatus,
    activeSubscription,
    isDevStore,
    currentPlanName,
    dailyCustomerLimit,
    fittingEnabled,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const lastDataRef = useRef<any>(null);
  const [dailyLimit, setDailyLimit] = useState(String(dailyCustomerLimit));
  const [isFittingEnabled, setIsFittingEnabled] = useState(fittingEnabled);

  useEffect(() => {
    const data = fetcher.data as any;
    if (!data || data === lastDataRef.current) return;
    lastDataRef.current = data;

    if (data.cancelled) {
      shopify.toast.show("Subscription cancelled");
    }
    if (data.fittingToggled) {
      shopify.toast.show(
        data.fittingEnabled
          ? "Virtual Try-On enabled"
          : "Virtual Try-On disabled"
      );
    }
    if (data.dailyLimitUpdated) {
      shopify.toast.show("Daily customer limit updated");
    }
    if (data.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleSubscribe = useCallback(
    (planKey: string) => {
      const formData = new FormData();
      formData.set("intent", "subscribe");
      formData.set("planKey", planKey);
      fetcher.submit(formData, { method: "POST" });
    },
    [fetcher]
  );

  const handleToggleFitting = useCallback((newValue: boolean) => {
    setIsFittingEnabled(newValue);
    const formData = new FormData();
    formData.set("intent", "toggleFitting");
    formData.set("fittingEnabled", String(newValue));
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher]);

  const handleSaveDailyLimit = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "updateDailyLimit");
    formData.set("dailyLimit", dailyLimit);
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, dailyLimit]);

  const handleCancel = useCallback(() => {
    if (!activeSubscription?.id) return;
    if (!confirm("Are you sure you want to cancel your subscription?")) return;

    const formData = new FormData();
    formData.set("intent", "cancel");
    formData.set("subscriptionId", activeSubscription.id);
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, activeSubscription]);

  const usagePercent =
    creditStatus.monthlyCredits > 0
      ? Math.min(
          100,
          (creditStatus.creditsUsed / creditStatus.monthlyCredits) * 100
        )
      : 0;

  const isSubmitting = fetcher.state !== "idle";

  return (
    <Page backAction={{ url: "/app" }} title="Billing & Points">
      <TitleBar title="Billing & Points" />
      <BlockStack gap="500">
        {/* Current Usage Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Current Usage
                  </Text>
                  <Badge
                    tone={
                      creditStatus.planKey === "free" ? "attention" : "success"
                    }
                  >
                    {currentPlanName}
                  </Badge>
                </InlineStack>

                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">
                      Points used
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {creditStatus.creditsUsed} / {creditStatus.monthlyCredits}
                    </Text>
                  </InlineStack>
                  <ProgressBar
                    progress={usagePercent}
                    tone={usagePercent >= 90 ? "critical" : "primary"}
                    size="small"
                  />
                  <Text as="p" variant="bodySm" tone="subdued">
                    {creditStatus.creditsRemaining} pt remaining
                    {creditStatus.planKey === "free"
                      ? " (one-time trial)"
                      : " this billing cycle"}
                  </Text>
                </BlockStack>

                {creditStatus.overageCreditsUsed > 0 && (
                  <Banner tone="warning">
                    <Text as="p" variant="bodySm">
                      {creditStatus.overageCreditsUsed} overage pt used ($
                      {(
                        creditStatus.overageCreditsUsed *
                        creditStatus.overageUsd
                      ).toFixed(2)}{" "}
                      additional charges)
                    </Text>
                  </Banner>
                )}

                {!creditStatus.canGenerate && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">
                      You&apos;ve used all your points. Upgrade your plan to
                      continue generating looks.
                    </Text>
                  </Banner>
                )}

                {activeSubscription && creditStatus.planKey !== "free" && (
                  <Box>
                    <Button
                      tone="critical"
                      variant="plain"
                      onClick={handleCancel}
                      loading={isSubmitting}
                    >
                      Cancel subscription
                    </Button>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Fitting Settings Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Virtual Try-On Settings
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Configure how the virtual try-on feature works for your
                  customers. Each try-on costs 1 pt from your plan.
                </Text>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    First-time setup: Add the <strong>VUAL Try-On</strong> block
                    in your Theme Editor (Customize Theme → Product page → Add
                    block). After that, use the toggle below to control
                    visibility.
                  </Text>
                </Banner>
                <Checkbox
                  label="Enable Virtual Try-On button on storefront"
                  helpText="When disabled, the Try-On button will be hidden from your product pages."
                  checked={isFittingEnabled}
                  onChange={handleToggleFitting}
                />
                <Divider />
                <TextField
                  label="Daily try-on limit per customer"
                  type="number"
                  value={dailyLimit}
                  onChange={setDailyLimit}
                  min={1}
                  max={100}
                  helpText="Maximum number of virtual try-ons a single customer can perform per day. Customers are identified by IP address."
                  autoComplete="off"
                />
                <InlineStack align="end">
                  <Button
                    onClick={handleSaveDailyLimit}
                    loading={isSubmitting}
                    disabled={String(dailyCustomerLimit) === dailyLimit}
                  >
                    Save
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {isDevStore && (
          <Banner tone="info">
            Development store detected — subscriptions will be created in test
            mode (no real charges).
          </Banner>
        )}

        {/* Plan Cards */}
        <Text as="h2" variant="headingLg">
          Choose a Plan
        </Text>

        <Layout>
          {plans
            .filter((p) => !p.isFree)
            .map((plan) => {
              const isCurrent = creditStatus.planKey === plan.key;
              const currentPlanPrice = plans.find((p) => p.key === creditStatus.planKey)?.priceUsd || 0;
              const isUpgrade = !isCurrent && plan.priceUsd > currentPlanPrice;

              return (
                <Layout.Section key={plan.key} variant="oneThird">
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingMd">
                          {plan.name}
                        </Text>
                        {isCurrent && <Badge tone="success">Current</Badge>}
                        {plan.key === "growth" && !isCurrent && (
                          <Badge tone="attention">Popular</Badge>
                        )}
                      </InlineStack>

                      <BlockStack gap="100">
                        <InlineStack gap="100" blockAlign="baseline">
                          <Text as="span" variant="headingXl">
                            ${plan.priceUsd}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            /month
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          ${(plan.priceUsd / plan.monthlyCredits).toFixed(2)}
                          /pt included
                        </Text>
                      </BlockStack>

                      <Divider />

                      <List>
                        {plan.features.map((f, i) => (
                          <List.Item key={i}>{f}</List.Item>
                        ))}
                      </List>

                      <Button
                        variant={
                          plan.key === "growth" ? "primary" : "secondary"
                        }
                        fullWidth
                        disabled={isCurrent || isSubmitting}
                        loading={isSubmitting}
                        onClick={() => handleSubscribe(plan.key)}
                      >
                        {isCurrent
                          ? "Current Plan"
                          : isUpgrade
                            ? `Upgrade to ${plan.name}`
                            : `Switch to ${plan.name}`}
                      </Button>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              );
            })}
        </Layout>

        {/* FAQ / Info */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              How points work
            </Text>
            <Text as="p" variant="bodySm">
              Each AI Studio generation uses 3 points. This includes the model
              photography image generation and automatic AI copywriting for
              collections. Saving images to products and creating collections
              does not cost additional points.
            </Text>
            <Text as="p" variant="bodySm">
              Virtual Try-On uses 1 point per try-on — one-third the cost of a
              Studio generation. This means your points go 3x as far for
              customer try-ons.
            </Text>
            <Text as="p" variant="bodySm">
              Points reset at the start of each billing cycle. Unused points
              do not roll over. If you exceed your monthly points, overage
              charges apply at the rate shown in your plan.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
