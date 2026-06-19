import { useCallback, useEffect, useRef, useState } from "react";
import { detectLocale, t } from "../lib/i18n";
import type { Locale } from "../lib/i18n";
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
    locale: detectLocale(request),
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
      return json({ confirmationUrl: result.confirmationUrl });
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
    locale,
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

    if (data.confirmationUrl) {
      window.open(data.confirmationUrl, "_top");
      return;
    }
    if (data.cancelled) {
      shopify.toast.show("Subscription cancelled");
    }
    if (data.fittingToggled) {
      shopify.toast.show(
        data.fittingEnabled
          ? t("billing.vton.toast_enabled", locale)
          : t("billing.vton.toast_disabled", locale)
      );
    }
    if (data.dailyLimitUpdated) {
      shopify.toast.show(t("billing.vton.toast_limit", locale));
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
    <Page backAction={{ url: "/app" }} title={t("billing.title", locale)}>
      <TitleBar title={t("billing.title", locale)} />
      <BlockStack gap="500">
        {/* Current Usage Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {t("billing.usage.heading", locale)}
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
                      {t("billing.usage.points_used", locale)}
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
                    {creditStatus.creditsRemaining} pt{creditStatus.planKey === "free"
                      ? t("billing.usage.trial", locale)
                      : t("billing.usage.cycle", locale)}
                  </Text>
                </BlockStack>

                {creditStatus.overageCreditsUsed > 0 && (
                  <Banner tone="warning">
                    <Text as="p" variant="bodySm">
                      {t("billing.usage.overage", locale)
                        .replace("{n}", String(creditStatus.overageCreditsUsed))
                        .replace("{amount}", (creditStatus.overageCreditsUsed * creditStatus.overageUsd).toFixed(2))}
                    </Text>
                  </Banner>
                )}

                {!creditStatus.canGenerate && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">
                      {t("billing.usage.exhausted", locale)}
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
                      {t("billing.usage.cancel", locale)}
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
                  {t("billing.vton.heading", locale)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("billing.vton.description", locale)}
                </Text>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    {t("billing.vton.setup", locale)}
                  </Text>
                </Banner>
                <Checkbox
                  label={t("billing.vton.enable_label", locale)}
                  helpText={t("billing.vton.enable_help", locale)}
                  checked={isFittingEnabled}
                  onChange={handleToggleFitting}
                />
                <Divider />
                <TextField
                  label={t("billing.vton.daily_label", locale)}
                  type="number"
                  value={dailyLimit}
                  onChange={setDailyLimit}
                  min={1}
                  max={100}
                  helpText={t("billing.vton.daily_help", locale)}
                  autoComplete="off"
                />
                <InlineStack align="end">
                  <Button
                    onClick={handleSaveDailyLimit}
                    loading={isSubmitting}
                    disabled={String(dailyCustomerLimit) === dailyLimit}
                  >
                    {t("billing.vton.save", locale)}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {isDevStore && (
          <Banner tone="info">
            {t("billing.dev_store", locale)}
          </Banner>
        )}

        {/* Plan Cards */}
        <Text as="h2" variant="headingLg">
          {t("billing.plans.heading", locale)}
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
                        {isCurrent && <Badge tone="success">{t("billing.plans.current_badge", locale)}</Badge>}
                        {plan.key === "growth" && !isCurrent && (
                          <Badge tone="attention">{t("billing.plans.popular_badge", locale)}</Badge>
                        )}
                      </InlineStack>

                      <BlockStack gap="100">
                        <InlineStack gap="100" blockAlign="baseline">
                          <Text as="span" variant="headingXl">
                            ${plan.priceUsd}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {t("billing.plans.month", locale)}
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          ${(plan.priceUsd / plan.monthlyCredits).toFixed(2)}
                          {t("billing.plans.pt_included", locale)}
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
                          ? t("billing.plans.current_btn", locale)
                          : isUpgrade
                            ? t("billing.plans.upgrade_btn", locale).replace("{name}", plan.name)
                            : t("billing.plans.switch_btn", locale).replace("{name}", plan.name)}
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
              {t("billing.faq.heading", locale)}
            </Text>
            <Text as="p" variant="bodySm">
              {t("billing.faq.p1", locale)}
            </Text>
            <Text as="p" variant="bodySm">
              {t("billing.faq.p2", locale)}
            </Text>
            <Text as="p" variant="bodySm">
              {t("billing.faq.p3", locale)}
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
