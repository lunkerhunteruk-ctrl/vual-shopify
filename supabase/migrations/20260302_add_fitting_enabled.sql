-- Add fitting_enabled flag to shopify_subscriptions
-- Allows merchants to disable the Virtual Try-On button via the app admin UI
-- without needing to remove the block from Shopify Theme Editor.
ALTER TABLE shopify_subscriptions
  ADD COLUMN IF NOT EXISTS fitting_enabled BOOLEAN NOT NULL DEFAULT true;
