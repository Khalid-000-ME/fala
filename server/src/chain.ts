import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, parseEventLogs, parseGwei, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.js";

const artifact = JSON.parse(readFileSync(new URL("../artifacts/FalaVault.json", import.meta.url), "utf8")) as { abi: any[]; bytecode: Hex };
export const vaultAbi = artifact.abi;
const dkimKeys = JSON.parse(readFileSync(new URL("./dkim-keys.json", import.meta.url), "utf8")) as Record<string, { selector: string; n: Hex; e: Hex }>;

const IDS = { local: 31337, testnet: 5042002, mainnet: 5042 } as const;
const EXPLORER = { local: "", testnet: "https://explorer.testnet.arc.io", mainnet: "https://explorer.arc.io" } as const;
export const USDC: Address = "0x3600000000000000000000000000000000000000";
export const chain = defineChain({
  id: IDS[env.network], name: `Arc ${env.network}`, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [env.rpc] } },
});
export const publicClient = createPublicClient({ chain, transport: http(env.rpc, { retryCount: 8, retryDelay: 400, timeout: 20_000 }) });
export const explorerTx = (h: string) => `${EXPLORER[env.network]}/tx/${h}`;
const fees = { maxFeePerGas: parseGwei("25"), maxPriorityFeePerGas: parseGwei("1") };

const walletFor = (key: Hex) => {
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain, transport: http(env.rpc, { retryCount: 8, retryDelay: 400, timeout: 20_000 }) }) };
};
export const deployer = () => walletFor(env.deployerKey());

// One in-flight write per sender key (nonce safety).
const queues = new Map<string, Promise<unknown>>();
export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  queues.set(key, next.catch(() => undefined));
  return next;
}

/** Deploy a vault owned by the user's Privy wallet that trusts Gmail's DKIM key and one approver address. */
export async function deployVault(owner: Address, approverEmail: string) {
  const k = dkimKeys["gmail.com"];
  const w = deployer();
  return serial(w.account.address, async () => {
    const hash = await w.client.deployContract({
      abi: vaultAbi, bytecode: artifact.bytecode, account: w.account, chain, ...fees,
      args: [USDC, owner, approverEmail, "gmail.com", k.selector, k.n, k.e],
    } as never);
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success" || !r.contractAddress) throw new Error("vault deployment failed");
    return { address: r.contractAddress, block: Number(r.blockNumber), tx: hash };
  });
}

/** Gas float for platform-held agent wallets (USDC is the gas token). */
export async function sendGas(to: Address, usdc = env.agentGas) {
  const w = deployer();
  return serial(w.account.address, async () => {
    const hash = await w.client.sendTransaction({ to, value: parseUnits(usdc, 18), account: w.account, chain, ...fees } as never);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  });
}

export const readVault = (address: Address, functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi: vaultAbi, functionName, args } as never) as Promise<any>;

export async function vaultState(address: Address) {
  const [balance, frozen, owner, ttl] = await Promise.all([readVault(address, "vaultBalance"), readVault(address, "frozen"), readVault(address, "owner"), readVault(address, "intentTtl")]);
  return { balance: balance as bigint, frozen: frozen as boolean, owner: owner as Address, intentTtl: Number(ttl) };
}

export async function agentCfg(vault: Address, agent: Address) {
  const c = await readVault(vault, "agents", [agent]);
  const today = Math.floor(Date.now() / 1000 / 86400);
  return { active: c[0] as boolean, autoPerTx: c[1] as bigint, autoDaily: c[2] as bigint, hardCap: c[3] as bigint, autoSpentToday: c[4] === today ? (c[5] as bigint) : 0n };
}

export const REJECTIONS = ["", "NOT_AGENT", "FROZEN", "BAD_INPUT", "OVER_HARD_CAP", "PAYOUT_FAILED"];
export const STATUSES = ["NONE", "PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED", "FAILED", "AUTO_PAID"];

/** An agent (platform-held key) asks the vault for a payment. */
export async function requestPayment(vault: Address, agentKey: Hex, payee: Address, amount6: bigint, memo: string) {
  const w = walletFor(agentKey);
  return serial(w.account.address, async () => {
    const hash = await w.client.writeContract({ address: vault, abi: vaultAbi, functionName: "request", args: [payee, amount6, memo], account: w.account, chain, ...fees } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const base = { txHash: hash, explorerUrl: explorerTx(hash) };
    for (const l of parseEventLogs({ abi: vaultAbi, logs: receipt.logs }) as any[]) {
      if (l.eventName === "AutoPaid") return { ...base, status: "auto_paid" as const };
      if (l.eventName === "IntentCreated") return { ...base, status: "pending" as const, intentId: String(l.args.id) };
      if (l.eventName === "IntentRejected") return { ...base, status: "rejected" as const, reason: REJECTIONS[Number(l.args.reason)] };
    }
    throw new Error(`tx ${hash} emitted no request event`);
  });
}

export async function intentInfo(vault: Address, id: bigint) {
  const i = await readVault(vault, "intents", [id]);
  return { id: String(id), agent: i[0] as Address, payee: i[1] as Address, amount: (Number(i[2]) / 1e6).toFixed(2), createdAt: Number(i[3]), expiresAt: Number(i[4]), status: STATUSES[Number(i[5])], memo: i[7] as string };
}

export function relayerClient(vault: Address) {
  const w = walletFor(env.relayerKey());
  return {
    check: async (hb: Hex, sg: Hex) => { const [verb, id] = (await readVault(vault, "checkEmail", [hb, sg])) as [number, bigint]; return { verb, id }; },
    submit: async (hb: Hex, sg: Hex) => serial(w.account.address, async () => {
      const hash = await w.client.writeContract({ address: vault, abi: vaultAbi, functionName: "approveByEmail", args: [hb, sg], account: w.account, chain, ...fees } as never);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      const base = { txHash: hash, explorerUrl: explorerTx(hash), gasUsed: r.gasUsed };
      for (const l of parseEventLogs({ abi: vaultAbi, logs: r.logs }) as any[]) {
        if (l.eventName === "Paid") return { ...base, verb: "APPROVE" as const, paid: true };
        if (l.eventName === "PayoutFailed") return { ...base, verb: "APPROVE" as const, paid: false };
        if (l.eventName === "EmailDenied") return { ...base, verb: "DENY" as const };
        if (l.eventName === "EmailFrozen") return { ...base, verb: "FREEZE" as const };
        if (l.eventName === "IntentClosed") return { ...base, verb: "EXPIRED" as const };
      }
      throw new Error(`tx ${hash} emitted no approval event`);
    }),
  };
}
