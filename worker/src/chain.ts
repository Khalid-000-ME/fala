import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  parseGwei,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { falaVaultAbi } from "./abi";
import type { IntentInfo, Outcome } from "./relay";

export type ChainEnv = {
  NETWORK: string;
  RPC_URL: string;
  VAULT_ADDRESS: string;
  RELAYER_PRIVATE_KEY: string;
  MAX_FEE_GWEI?: string;
  PRIORITY_FEE_GWEI?: string;
};

const IDS: Record<string, number> = { local: 31337, testnet: 5042002, mainnet: 5042 };
const EXPLORERS: Record<string, string> = { testnet: "https://explorer.testnet.arc.io", mainnet: "https://explorer.arc.io" };
const STATUSES = ["NONE", "PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED", "FAILED", "AUTO_PAID"];

export function chainClient(env: ChainEnv) {
  const chain = defineChain({
    id: IDS[env.NETWORK] ?? 5042002,
    name: `Arc ${env.NETWORK}`,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [env.RPC_URL] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(env.RPC_URL) });
  const key = env.RELAYER_PRIVATE_KEY.startsWith("0x") ? env.RELAYER_PRIVATE_KEY : `0x${env.RELAYER_PRIVATE_KEY}`;
  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({ account, chain, transport: http(env.RPC_URL) });
  const address = env.VAULT_ADDRESS as Address;
  const explorerTx = (h: string) => `${EXPLORERS[env.NETWORK] ?? ""}/tx/${h}`;
  const read = (functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address, abi: falaVaultAbi, functionName, args } as never) as Promise<any>;

  return {
    publicClient,
    address,
    explorerTx,
    read,

    async check(hb: Hex, sg: Hex) {
      const [verb, id] = (await read("checkEmail", [hb, sg])) as [number, bigint];
      return { verb, id };
    },

    async submit(hb: Hex, sg: Hex): Promise<Outcome> {
      const hash = await wallet.writeContract({
        address, abi: falaVaultAbi, functionName: "approveByEmail", args: [hb, sg], account, chain,
        maxFeePerGas: parseGwei(env.MAX_FEE_GWEI ?? "25"), maxPriorityFeePerGas: parseGwei(env.PRIORITY_FEE_GWEI ?? "1"),
      } as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const base = { txHash: hash, explorerUrl: explorerTx(hash), gasUsed: receipt.gasUsed };
      for (const l of parseEventLogs({ abi: falaVaultAbi, logs: receipt.logs })) {
        if (l.eventName === "Paid") return { ...base, verb: "APPROVE", paid: true };
        if (l.eventName === "PayoutFailed") return { ...base, verb: "APPROVE", paid: false };
        if (l.eventName === "EmailDenied") return { ...base, verb: "DENY" };
        if (l.eventName === "EmailFrozen") return { ...base, verb: "FREEZE" };
        if (l.eventName === "IntentClosed") return { ...base, verb: "EXPIRED" };
      }
      throw new Error(`tx ${hash} emitted no approval event`);
    },

    async intent(id: bigint): Promise<IntentInfo & { expiresAt: number; agent: string }> {
      const i = await read("intents", [id]);
      return {
        id: String(id), agent: i[0], payee: i[1], amount: (Number(i[2]) / 1e6).toFixed(2), expiresAt: Number(i[4]),
        status: STATUSES[Number(i[5])], memo: i[7],
      };
    },

    subject: (id: bigint, verb: 1 | 2 | 3): Promise<string> => read("subjectFor", [id, verb]),

    errorName(e: unknown): string {
      if (e instanceof BaseError) {
        const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
        if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? r.shortMessage;
        return e.shortMessage;
      }
      return e instanceof Error ? e.message : String(e);
    },
  };
}
