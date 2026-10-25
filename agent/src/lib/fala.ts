import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { falaVaultAbi } from "./abi.js";
import { chain, explorerTx, gas, privateKey, RPC_URL, vaultAddress, type Role } from "./config.js";
import { fromUsdc6, toUsdc6 } from "./units.js";

export const STATUSES = ["NONE", "PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED", "FAILED", "AUTO_PAID"] as const;
export const REJECTIONS = ["", "NOT_AGENT", "FROZEN", "BAD_INPUT", "OVER_HARD_CAP", "PAYOUT_FAILED"] as const;
export const VERBS = { APPROVE: 1, DENY: 2, FREEZE: 3 } as const;

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

export async function write(role: Role, functionName: string, args: unknown[], value?: bigint) {
  return serialize(role, async () => {
    const { client, account } = wallet(role);
    const hash = await client.writeContract({
      address: vaultAddress(), abi: falaVaultAbi, functionName, args, account, chain, value, ...gas,
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return { hash, receipt };
  });
}

const read = (functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address: vaultAddress(), abi: falaVaultAbi, functionName, args } as never) as Promise<any>;

/** The contract's named error (e.g. "BadSignature") from a failed call, or the raw message. */
export function errorName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? r.shortMessage;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

// ------------------------------------------------------------------ agent

export type RequestResult = {
  status: "auto_paid" | "pending" | "rejected";
  intentId?: string;
  reason?: string;
  subject?: string;
  txHash: string;
  explorerUrl: string;
};

export async function requestPayment(payee: Address, amountUsdc: string, memo: string): Promise<RequestResult> {
  const { hash, receipt } = await write("agent", "request", [payee, toUsdc6(amountUsdc), memo]);
  const base = { txHash: hash, explorerUrl: explorerTx(hash) };
  for (const l of parseEventLogs({ abi: falaVaultAbi, logs: receipt.logs })) {
    if (l.eventName === "AutoPaid") return { ...base, status: "auto_paid" };
    if (l.eventName === "IntentCreated") return { ...base, status: "pending", intentId: String(l.args.id) };
    if (l.eventName === "IntentRejected") return { ...base, status: "rejected", reason: REJECTIONS[Number(l.args.reason)] };
  }
  throw new Error(`tx ${hash} emitted no request event`);
}

export async function allowance(agent: Address = addressOf("agent")) {
  const [cfg, frozen, balance] = await Promise.all([read("agents", [agent]), read("frozen"), read("vaultBalance")]);
  return {
    active: cfg[0] as boolean,
    autoPerTx: fromUsdc6(cfg[1]),
    autoDaily: fromUsdc6(cfg[2]),
    hardCap: fromUsdc6(cfg[3]),
    autoSpentToday: cfg[4] === Math.floor(Date.now() / 1000 / 86400) ? fromUsdc6(cfg[5]) : "0",
    vaultBalance: fromUsdc6(balance),
    frozen: frozen as boolean,
  };
}

export async function intent(id: bigint) {
  const i = await read("intents", [id]);
  return {
    id: String(id), agent: i[0] as Address, payee: i[1] as Address, amount: fromUsdc6(i[2]), createdAt: Number(i[3]),
    expiresAt: Number(i[4]), status: STATUSES[Number(i[5])], code: i[6] as Hex, memo: i[7] as string,
  };
}

export const subjectFor = (id: bigint, verb: 1 | 2 | 3): Promise<string> => read("subjectFor", [id, verb]);

// ------------------------------------------------------------------ relayer (email path)

export type EmailOutcome = { verb: "APPROVE" | "DENY" | "FREEZE" | "EXPIRED"; paid?: boolean; txHash: string; explorerUrl: string; gasUsed: bigint };

/** Dry-run: resolves with the parsed verb/id, or throws the contract's named error. */
export async function checkEmail(headerBlock: Hex, sig: Hex) {
  const [verb, id] = (await read("checkEmail", [headerBlock, sig])) as [number, bigint];
  return { verb, id };
}

export async function submitEmail(headerBlock: Hex, sig: Hex): Promise<EmailOutcome> {
  const { hash, receipt } = await write("relayer", "approveByEmail", [headerBlock, sig]);
  const logs = parseEventLogs({ abi: falaVaultAbi, logs: receipt.logs });
  const base = { txHash: hash, explorerUrl: explorerTx(hash), gasUsed: receipt.gasUsed };
  for (const l of logs) {
    if (l.eventName === "Paid") return { ...base, verb: "APPROVE", paid: true };
    if (l.eventName === "PayoutFailed") return { ...base, verb: "APPROVE", paid: false };
    if (l.eventName === "EmailDenied") return { ...base, verb: "DENY" };
    if (l.eventName === "EmailFrozen") return { ...base, verb: "FREEZE" };
    if (l.eventName === "IntentClosed") return { ...base, verb: "EXPIRED" };
  }
  throw new Error(`tx ${hash} emitted no approval event`);
}
