"use client";

import { useSignTransaction, useWallets } from "@privy-io/react-auth";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { useCallback } from "react";
import { usePublicClient } from "wagmi";
import { ACTIVE, GAS, explorerTx } from "../config/chain";
import { falaVaultAbi } from "./abi";
import { useTx } from "../hooks/useTx";

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
      try {
        const [nonce, gas] = await Promise.all([
          publicClient.getTransactionCount({ address, blockTag: "pending" }),
          publicClient.estimateGas({ account: address, to, data, value }).catch(() => 2_000_000n),
        ]);
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
          { address },
        );
        // eth_signTransaction returns the serialized signed transaction, not a bare 65-byte signature.
        if (signature.length <= 134) throw new Error("Your wallet returned a signature instead of a signed transaction");
        const hash = await publicClient.sendRawTransaction({ serializedTransaction: signature });
        toast(`${label} submitted`, "info", hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") return toast(`${label} reverted`, "bad", hash), false;
        toast(`${label} confirmed`, "ok", hash);
        return true;
      } catch (e: any) {
        const msg = e?.shortMessage ?? e?.message ?? "Transaction failed";
        toast(/denied|rejected|cancel/i.test(msg) ? "You cancelled that transaction" : msg, "bad");
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
