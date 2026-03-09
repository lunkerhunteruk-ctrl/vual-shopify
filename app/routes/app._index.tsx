import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  ProgressBar,
  Badge,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCreditStatus } from "../../lib/billing/credit-tracker.server";
import { getPlanByKey } from "../../lib/billing/plans.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const creditStatus = await getCreditStatus(session.shop);
  const plan = getPlanByKey(creditStatus.planKey);
  return json({ creditStatus, planName: plan?.name || creditStatus.planKey });
};

export default function Index() {
  const { creditStatus, planName } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const usagePercent =
    creditStatus.monthlyCredits > 0
      ? Math.min(100, (creditStatus.creditsUsed / creditStatus.monthlyCredits) * 100)
      : 0;

  return (
    <Page>
      <TitleBar title="VUAL Studio" />
      <BlockStack gap="500">
        {/* Credit Status */}
        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Points</Text>
                  <Badge tone={creditStatus.planKey === "free" ? "attention" : "success"}>
                    {planName}
                  </Badge>
                </InlineStack>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">
                      {creditStatus.creditsUsed} / {creditStatus.monthlyCredits} used
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {creditStatus.creditsRemaining} remaining
                    </Text>
                  </InlineStack>
                  <ProgressBar
                    progress={usagePercent}
                    tone={usagePercent >= 90 ? "critical" : "primary"}
                    size="small"
                  />
                </BlockStack>
                {!creditStatus.canGenerate && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">
                      No points remaining. Upgrade to continue.
                    </Text>
                  </Banner>
                )}
                <Button
                  onClick={() => navigate("/app/billing")}
                  variant={creditStatus.planKey === "free" ? "primary" : "secondary"}
                  fullWidth
                >
                  {creditStatus.planKey === "free" ? "Upgrade Plan" : "Manage Billing"}
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">AI Studio</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Generate professional model photography with AI. Select
                  products, choose a model, and create stunning look images.
                </Text>
                <Button
                  onClick={() => navigate("/app/studio")}
                  variant="primary"
                  fullWidth
                >
                  Open Studio
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
