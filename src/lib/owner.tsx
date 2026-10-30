"use client";

import { useSignTransaction, useWallets } from "@privy-io/react-auth";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { useCallback } from "react";
import { usePublicClient } from "wagmi";
import { ACTIVE, GAS, explorerTx } from "../config/chain";
import { falaVaultAbi } from "./abi";
import { useTx } from "../hooks/useTx";
import { API } from "./api";

/**
 * The signed-in user's Privy wallet owns their vaults and signs every owner action.
 *
 * Privy only signs here; we build and broadcast the transaction against Arc ourselves. Privy's own
 * send path routes through its backend, which has no RPC for Arc, so it fails with "HTTP request failed".
 */
export function useOwnerWallet() {
  const { wallets, ready } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { toast } = useTx();
  const publicClient = usePublicClient();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const address = wallet?.address as Address | undefined;

  const send = useCallback(
    async (to: Address, data: Hex | undefined, value: bigint, label: string) => {
      if (!wallet || !address) return toast("Your wallet isn't ready yet — give it a second", "bad"), false;
      if (!publicClient) return toast("No connection to Arc — try again in a moment", "bad"), false;
      let step = "nonce";
      try {
        const nonce = await publicClient.getTransactionCount({ address, blockTag: "pending" });
        step = "gas";
        const gas = await publicClient.estimateGas({ account: address, to, data, value }).catch(() => 2_000_000n);
        step = "sign";
        const { signature } = await signTransaction(
          {
            to,
            from: address,
            data,
            value: `0x${value.toString(16)}`,
            nonce,
            gasLimit: `0x${((gas * 12n) / 10n).toString(16)}`,
            maxFeePerGas: `0x${GAS.maxFeePerGas.toString(16)}`,
            maxPriorityFeePerGas: `0x${GAS.maxPriorityFeePerGas.toString(16)}`,
            chainId: ACTIVE.id,
            type: 2,
          },
          // Privy's modal prices gas through its own RPC, which does not serve Arc. Skip it for this call.
          { address, uiOptions: { showWalletUIs: false } },
        );
        // eth_signTransaction returns the serialized signed transaction, not a bare 65-byte signature.
        if (signature.length <= 134) throw new Error("Your wallet returned a signature instead of a signed transaction");
        step = "broadcast";
        const hash = await publicClient.sendRawTransaction({ serializedTransaction: signature });
        toast(`${label} submitted`, "info", hash);
        step = "receipt";
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") return toast(`${label} reverted`, "bad", hash), false;
        toast(`${label} confirmed`, "ok", hash);
        return true;
      } catch (e: any) {
        const diag = describe(e, step, label, address);
        console.error("[fala] transaction failed", diag, e);
        void reportClientError(diag);
        const msg = e?.shortMessage ?? e?.message ?? "Transaction failed";
        if (/denied|rejected|cancel/i.test(msg)) toast("You cancelled that transaction", "bad");
        else toast(`${label} failed at "${step}": ${msg}${diag.host ? ` (${diag.host}${diag.status ? ` ${diag.status}` : ""})` : ""}`, "bad");
        return false;
      }
    },
    [wallet, address, publicClient, signTransaction, toast],
  );

  const write = useCallback(
    (vault: Address, functionName: string, args: unknown[], label: string, value = 0n) =>
      send(vault, encodeFunctionData({ abi: falaVaultAbi, functionName, args } as never), value, label),
    [send],
  );

  const sendUsdc = useCallback(
    (to: Address, usdc: string, label: string) => send(to, undefined, BigInt(Math.round(Number(usdc) * 1e18)), label),
    [send],
  );

  return { wallet, address, ready, write, sendUsdc, explorerTx };
}

/** Everything needed to pin down a failure: which step, which URL, what the server said. */
function describe(e: any, step: string, label: string, address: string) {
  const chain: any[] = [];
  for (let x = e, i = 0; x && i < 6; x = x.cause, i++) chain.push({ name: x.name, shortMessage: x.shortMessage, message: String(x.message ?? "").slice(0, 400), url: x.url, status: x.status, details: x.details, code: x.code });
  const url = chain.find((c) => c.url)?.url as string | undefined;
  let host: string | undefined;
  try { host = url ? new URL(url).host : undefined; } catch { host = url; }
  return { step, label, address, host, url, status: chain.find((c) => c.status)?.status, chain, at: new Date().toISOString() };
}

/** Send failure details to the API so they can be read from the server log without copying anything. */
async function reportClientError(diag: unknown) {
  try {
    await fetch(`${API}/debug/client-error`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(diag) });
  } catch { /* best effort */ }
}
