-- Shopify Billing: Subscription tracking & credit usage
-- Run in Supabase SQL Editor

-- Shop subscription records
CREATE TABLE IF NOT EXISTS shopify_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain TEXT NOT NULL,
  plan_key TEXT NOT NULL DEFAULT 'free',
  shopify_subscription_id TEXT,
  monthly_credits INTEGER NOT NULL DEFAULT 5,
  overage_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  billing_cycle_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  billing_cycle_end TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shopify_subs_shop ON shopify_subscriptions(shop_domain);
CREATE INDEX IF NOT EXISTS idx_shopify_subs_status ON shopify_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_shopify_subs_shopify_id ON shopify_subscriptions(shopify_subscription_id);

-- Credit usage log
CREATE TABLE IF NOT EXISTS shopify_credit_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES shopify_subscriptions(id),
  shop_domain TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  is_overage BOOLEAN NOT NULL DEFAULT false,
  overage_amount_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopify_usage_sub ON shopify_credit_usage(subscription_id);
CREATE INDEX IF NOT EXISTS idx_shopify_usage_shop ON shopify_credit_usage(shop_domain);

-- RLS: service role only (server-side access)
ALTER TABLE shopify_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_credit_usage ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "service_role_shopify_subs" ON shopify_subscriptions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_shopify_usage" ON shopify_credit_usage
  FOR ALL USING (true) WITH CHECK (true);
