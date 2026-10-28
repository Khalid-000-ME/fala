import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, quiet: true });

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} in server/.env`);
  return v;
};
const opt = (k: string, d = "") => process.env[k] || d;
const hex = (v: string) => (v.startsWith("0x") ? v : `0x${v}`) as `0x${string}`;

export const env = {
  privyAppId: () => need("PRIVY_APP_ID"),
  privySecret: () => need("PRIVY_APP_SECRET"),
  secret: () => need("SERVER_SECRET"),
  deployerKey: () => hex(need("DEPLOYER_PRIVATE_KEY")),
  relayerKey: () => hex(need("RELAYER_PRIVATE_KEY")),
  network: opt("NETWORK", "testnet") as "local" | "testnet" | "mainnet",
  rpc: opt("RPC_URL", "https://rpc.testnet.arc.io"),
  port: Number(opt("PORT", "8787")),
  publicUrl: opt("PUBLIC_URL", "http://localhost:8787"),
  webOrigin: opt("WEB_ORIGIN", "http://localhost:5173"),
  agentGas: opt("AGENT_GAS_USDC", "0.3"),
  groqKey: () => opt("GROQ_API_KEY"),
  model: () => opt("MODEL", "openai/gpt-oss-120b"),
  relayGmail: () => opt("RELAY_GMAIL"),
  relayPass: () => opt("RELAY_APP_PASSWORD"),
  devLogin: opt("DEV_LOGIN") === "1", // test-only login stub, never enable in production
  dbUrl: opt("DB_URL", `file:${new URL("../fala.db", import.meta.url).pathname}`),
};
