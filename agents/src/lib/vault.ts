import { createPublicClient, createWalletClient, http, parseEventLogs, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { falaVaultAbi } from "./abi.js";
import { chain, explorerTx, gas, privateKey, RPC_URL, vaultAddress, type Role } from "./config.js";
import { fromUsdc6, toUsdc6 } from "./units.js";

export const REASONS = [
  "NONE", "PAUSED", "UNKNOWN_AGENT", "AGENT_FROZEN", "POLICY_EXPIRED", "ZERO_AMOUNT", "NOTE_TOO_LONG",
  "PAYEE_NOT_ALLOWED", "OVER_PER_TX_CAP", "OVER_DAILY_TX_COUNT", "OVER_DAILY_CAP", "INSUFFICIENT_VAULT_FUNDS",
  "TRANSFER_FAILED", "PENDING_EXPIRED",
] as const;
export const STATUSES = ["NONE", "PENDING", "EXECUTED", "REJECTED", "FAILED"] as const;

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

const wallets = new Map<Role, ReturnType<typeof makeWallet>>();
function makeWallet(role: Role) {
  const account = privateKeyToAccount(privateKey(role));
  return { account, client: createWalletClient({ account, chain, transport: http(RPC_URL) }) };
}
export const wallet = (role: Role) => {
  if (!wallets.has(role)) wallets.set(role, makeWallet(role));
  return wallets.get(role)!;
};
export const addressOf = (role: Role) => wallet(role).account.address;

// One in-flight write per key to avoid nonce clashes.
const queues = new Map<Role, Promise<unknown>>();
function serialize<T>(role: Role, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(role) ?? Promise.resolve()).then(fn, fn);
  queues.set(role, next.catch(() => undefined));
  return next;
}

async function write(role: Role, functionName: string, args: unknown[]) {
  return serialize(role, async () => {
    const { client, account } = wallet(role);
    const hash = await client.writeContract({
      address: vaultAddress(), abi: falaVaultAbi, functionName, args, account, chain, ...gas,
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  });
}

export type SpendResult = {
  status: "executed" | "blocked" | "queued";
  reason?: string;
  pendingId?: string;
  txHash: string;
  explorerUrl: string;
};

export async function spend(role: Role, payee: Address, amountUsdc: string, note: string): Promise<SpendResult> {
  const { hash, receipt } = await write(role, "spend", [payee, toUsdc6(amountUsdc), note]);
  const logs = parseEventLogs({ abi: falaVaultAbi, logs: receipt.logs });
  const base = { txHash: hash, explorerUrl: explorerTx(hash) };
  for (const l of logs) {
    if (l.eventName === "SpendBlocked") return { ...base, status: "blocked", reason: REASONS[Number(l.args.reason)] };
    if (l.eventName === "SpendQueued") return { ...base, status: "queued", pendingId: String(l.args.pendingId) };
    if (l.eventName === "SpendExecuted") return { ...base, status: "executed" };
  }
  throw new Error(`tx ${hash} emitted no spend event`);
}

export const approve = (id: bigint) => write("auditor", "approve", [id]);
export const reject = (id: bigint) => write("auditor", "reject", [id]);
export const freeze = (agent: Address, frozen: boolean) => write("owner", "freezeAgent", [agent, frozen]);

const read = <T extends string>(functionName: T, args: unknown[] = []) =>
  publicClient.readContract({ address: vaultAddress(), abi: falaVaultAbi, functionName, args } as never) as Promise<any>;

export async function budget(agent: Address) {
  const [p, rem] = await Promise.all([read("getPolicy", [agent]), read("remainingToday", [agent])]);
  return {
    perTxCap: fromUsdc6(p.perTxCap), coSignThreshold: fromUsdc6(p.coSignThreshold), dailyCap: fromUsdc6(p.dailyCap),
    remainingToday: fromUsdc6(rem[0]), txLeftToday: String(rem[1]),
    expiry: p.expiry ? new Date(Number(p.expiry) * 1000).toISOString() : "never", frozen: !p.active,
  };
}
export const payeeAllowed = (agent: Address, payee: Address): Promise<boolean> => read("payeeAllowed", [agent, payee]);
export async function checkSpend(agent: Address, payee: Address, amountUsdc: string, note: string) {
  const r = Number(await read("check", [agent, payee, toUsdc6(amountUsdc), note]));
  if (r !== 0) return { wouldBe: "block" as const, reason: REASONS[r] };
  const p = await read("getPolicy", [agent]);
  return { wouldBe: toUsdc6(amountUsdc) > p.coSignThreshold ? ("queue" as const) : ("execute" as const), reason: "NONE" };
}
export async function pendingStatus(id: bigint) {
  const p = await read("pendings", [id]);
  return { status: STATUSES[Number(p[4])], agent: p[0] as Address, payee: p[1] as Address, amount: fromUsdc6(p[2]), note: p[5] as string };
}
