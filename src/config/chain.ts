import { defineChain } from "viem";

const usdcNative = { name: "USDC", symbol: "USDC", decimals: 18 } as const;

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: usdcNative,
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: usdcNative,
  rpcUrls: { default: { http: [import.meta.env.VITE_TESTNET_RPC ?? "https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

export const localChain = defineChain({
  id: 31337,
  name: "Local",
  nativeCurrency: usdcNative,
  rpcUrls: { default: { http: [import.meta.env.VITE_LOCAL_RPC ?? "http://127.0.0.1:8545"] } },
});

export type NetworkName = "mainnet" | "testnet" | "local";
export const NETWORK = (import.meta.env.VITE_NETWORK ?? "testnet") as NetworkName;
export const ACTIVE = { mainnet: arcMainnet, testnet: arcTestnet, local: localChain }[NETWORK] ?? arcTestnet;

const rawVault = import.meta.env.VITE_VAULT_ADDRESS as string | undefined;
export const VAULT = (rawVault && rawVault.startsWith("0x") ? rawVault : undefined) as `0x${string}` | undefined;
export const VAULT_DEPLOY_BLOCK = BigInt(import.meta.env.VITE_VAULT_DEPLOY_BLOCK || 0);
/** No vault configured → the dashboard renders demo data and disables writes. */
export const DEMO = !VAULT;

// USDC ERC-20 interface on Arc: 6 decimals (native gas balance is 18 — never mix the two views).
export const USDC = (import.meta.env.VITE_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as `0x${string}`;
export const USDC_DECIMALS = 6;

// Arc's mempool floor is 20 gwei.
export const GAS = { maxFeePerGas: 25_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n } as const;

export const explorerTx = (hash: string) => (ACTIVE.blockExplorers ? `${ACTIVE.blockExplorers.default.url}/tx/${hash}` : "#");
export const explorerAddr = (a: string) => (ACTIVE.blockExplorers ? `${ACTIVE.blockExplorers.default.url}/address/${a}` : "#");
