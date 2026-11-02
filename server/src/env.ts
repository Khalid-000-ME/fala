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
  /**
   * ARC_RPC wins over RPC_URL so the endpoint can be set in fly.toml beside NETWORK, without
   * touching the secret store. Falling back by network keeps the two from ever disagreeing.
   */
  get rpc(): string {
    return opt("ARC_RPC") || opt("RPC_URL") || (this.network === "mainnet" ? "https://rpc.mainnet.arc.io" : "https://rpc.testnet.arc.io");
  },
  port: Number(opt("PORT", "8787")),
  publicUrl: opt("PUBLIC_URL", "http://localhost:8787"),
  /**
   * Every origin allowed to call this API, as a comma-separated list. WEB_ORIGINS wins over
   * WEB_ORIGIN so the deployed origin can be set in fly.toml without touching the secret store.
   * The first entry is the one emails link to.
   */
  origins: () => (opt("WEB_ORIGINS") || opt("WEB_ORIGIN") || "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
  get webOrigin() { return this.origins()[0]; },
  agentGas: opt("AGENT_GAS_USDC", "0.3"),
  /**
   * Vault deploys and agent gas floats are paid by the platform wallet, so on a real-money network
   * an open sign-up drains it. Empty means no limit, which is only safe on testnet.
   * MAX_VAULTS_PER_USER caps how many vaults one account can deploy at our expense.
   */
  allowedApprovers: () => opt("ALLOWED_APPROVERS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  maxVaultsPerUser: Number(opt("MAX_VAULTS_PER_USER", "0")) || 0,
  groqKey: () => opt("GROQ_API_KEY"),
  model: () => opt("MODEL", "openai/gpt-oss-120b"),
  relayGmail: () => opt("RELAY_GMAIL"),
  relayPass: () => opt("RELAY_APP_PASSWORD"),
  devLogin: opt("DEV_LOGIN") === "1", // test-only login stub, never enable in production
  dbUrl: opt("DB_URL", `file:${new URL("../fala.db", import.meta.url).pathname}`),
};
