import "dotenv/config";
import { defineChain, parseGwei, type Address, type Hex } from "viem";

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k} (see .env.example)`);
  return v;
};
const opt = (k: string) => process.env[k] || undefined;

export const NETWORK = (opt("NETWORK") ?? "testnet") as "local" | "testnet" | "mainnet";
const ids = { local: 31337, testnet: 5042002, mainnet: 5042 } as const;
const explorers = { local: "", testnet: "https://explorer.testnet.arc.io", mainnet: "https://explorer.arc.io" } as const;
const defaultRpc = { local: "http://127.0.0.1:8545", testnet: "https://rpc.testnet.arc.io", mainnet: "https://rpc.mainnet.arc.io" } as const;

export const RPC_URL = opt("RPC_URL") ?? defaultRpc[NETWORK];
export const chain = defineChain({
  id: ids[NETWORK],
  name: `Arc ${NETWORK}`,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const vaultAddress = () => need("VAULT_ADDRESS") as Address;
export const deployBlock = () => BigInt(opt("VAULT_DEPLOY_BLOCK") ?? 0);
export const explorerTx = (h: string) => (explorers[NETWORK] ? `${explorers[NETWORK]}/tx/${h}` : h);

// Arc's mempool floor is 20 gwei; 25 leaves headroom.
export const gas = {
  maxFeePerGas: parseGwei(opt("MAX_FEE_GWEI") ?? "25"),
  maxPriorityFeePerGas: parseGwei(opt("PRIORITY_FEE_GWEI") ?? "1"),
};

export type Role = "worker" | "auditor" | "rogue" | "owner";
const keyEnv: Record<Role, string> = { worker: "AGENT_PRIVATE_KEY", auditor: "AUDITOR_PRIVATE_KEY", rogue: "ROGUE_PRIVATE_KEY", owner: "OWNER_PRIVATE_KEY" };
export const privateKey = (r: Role): Hex => {
  const v = need(keyEnv[r]).trim();
  return (v.startsWith("0x") ? v : `0x${v}`) as Hex;
};

export const model = () => opt("MODEL") ?? "llama-3.3-70b-versatile";
export const groqKey = () => opt("GROQ_API_KEY");

export const addresses = () => ({
  VENDOR_A: need("VENDOR_A") as Address,
  VENDOR_B: need("VENDOR_B") as Address,
  ATTACKER: need("ATTACKER_ADDRESS") as Address,
});
export const labelFor = (a: string) => {
  const m = addresses();
  const hit = Object.entries(m).find(([, v]) => v.toLowerCase() === a.toLowerCase());
  return hit?.[0] ?? "UNKNOWN";
};
