/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the workspace package so Next.js's bundler handles its
  // TypeScript directly rather than requiring a separate build step -
  // simplest option for a monorepo at this stage.
  transpilePackages: ["@workpulse/shared-types"],
  async rewrites() {
    return [
      {
        // Lets the browser call same-origin /api/backend/* in dev without
        // hitting CORS, proxied straight through to the NestJS API.
        source: "/api/backend/:path*",
        destination: `${process.env.API_BASE_URL ?? "http://localhost:4000"}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
