import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  webpack: (cfg) => {
    // Optional peer deps reached by wagmi's and Privy's barrels (Coinbase x402, Farcaster mini-apps).
    // We use none of them; without these stubs webpack fails to resolve and Privy never initializes.
    for (const m of ["@x402/evm", "@x402/common", "@x402/svm", "@farcaster/mini-app-solana"]) {
      cfg.resolve.alias = { ...cfg.resolve.alias, [m]: false };
    }
    return cfg;
  },
};

export default config;
