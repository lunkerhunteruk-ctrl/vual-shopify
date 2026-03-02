-- Add daily customer limit to subscriptions
ALTER TABLE shopify_subscriptions
  ADD COLUMN IF NOT EXISTS daily_customer_limit INTEGER NOT NULL DEFAULT 5;

-- Add customer IP tracking to credit usage
ALTER TABLE shopify_credit_usage
  ADD COLUMN IF NOT EXISTS customer_ip TEXT;

-- Index for efficient daily limit lookups
CREATE INDEX IF NOT EXISTS idx_shopify_usage_ip_date
  ON shopify_credit_usage(shop_domain, customer_ip, created_at);
