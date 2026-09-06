-- Add RENDER as a provider (owner request: visibility into Render-hosted
-- sites alongside Google Cloud). Postgres requires ALTER TYPE ... ADD VALUE
-- to run outside a transaction block.
ALTER TYPE "Provider" ADD VALUE 'RENDER';
