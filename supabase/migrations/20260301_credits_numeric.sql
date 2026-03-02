-- Change credits columns from INTEGER to NUMERIC to support fractional credits (0.5 for fitting)
-- Run in Supabase SQL Editor

ALTER TABLE shopify_subscriptions
  ALTER COLUMN credits_used TYPE NUMERIC(10,1) USING credits_used::NUMERIC(10,1);

ALTER TABLE shopify_credit_usage
  ALTER COLUMN credits TYPE NUMERIC(10,1) USING credits::NUMERIC(10,1);
