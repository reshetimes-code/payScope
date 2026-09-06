/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker/Cloud Run deployment (spec §32, production hosting) — traces only
  // the files each page actually needs into .next/standalone, so the image
  // doesn't ship the full node_modules tree.
  output: 'standalone',
  // Keep server-only Google/OpenAI/Anthropic SDKs out of the client bundle.
  serverExternalPackages: [
    '@google-cloud/resource-manager',
    '@google-cloud/billing',
    '@google-cloud/billing-budgets',
    '@google-cloud/bigquery',
    '@google-cloud/secret-manager',
    '@google-cloud/run',
    '@google-cloud/pubsub',
  ],
};

export default nextConfig;
