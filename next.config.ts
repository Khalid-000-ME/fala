import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  webpack: (cfg) => {
    // wagmi's connector barrel reaches into Coinbase's SDK, which has optional deps we never use.
    cfg.resolve.alias = { ...cfg.resolve.alias, "@x402/evm": false, "@x402/common": false };
    return cfg;
  },
};

export default config;
