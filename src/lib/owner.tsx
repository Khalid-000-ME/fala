import { useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, parseUnits, type Address } from "viem";
import { useCallback } from "react";
import { ACTIVE, GAS, explorerTx } from "../config/chain";
import { falaVaultAbi } from "./abi";
import { useTx } from "../hooks/useTx";
import { usePublicClient } from "wagmi";

/** The signed-in user's Privy embedded wallet: it owns their vaults and signs every owner action. */
export function useOwnerWallet() {
  const { wallets, ready } = useWallets();
  const { toast } = useTx();
  const publicClient = usePublicClient();
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];

  const write = useCallback(
    async (vault: Address, functionName: string, args: unknown[], label: string, value?: bigint) => {
      if (!wallet) return toast("Your wallet isn't ready yet — give it a second", "bad"), false;
      try {
        await wallet.switchChain(ACTIVE.id);
        const provider = await wallet.getEthereumProvider();
        const client = createWalletClient({ account: wallet.address as Address, chain: ACTIVE, transport: custom(provider) });
        const hash = await client.writeContract({ address: vault, abi: falaVaultAbi, functionName, args, value, ...GAS } as never);
        toast(`${label} submitted`, "info", hash);
        await publicClient!.waitForTransactionReceipt({ hash });
        toast(`${label} confirmed`, "ok", hash);
        return true;
      } catch (e: any) {
        toast(e?.shortMessage ?? e?.message ?? "Transaction failed", "bad");
        return false;
      }
    },
    [wallet, toast, publicClient],
  );

  const sendUsdc = useCallback(
    async (to: Address, usdc: string, label: string) => {
      if (!wallet) return false;
      try {
        await wallet.switchChain(ACTIVE.id);
        const client = createWalletClient({ account: wallet.address as Address, chain: ACTIVE, transport: custom(await wallet.getEthereumProvider()) });
        const hash = await client.sendTransaction({ to, value: parseUnits(usdc, 18), ...GAS } as never);
        await publicClient!.waitForTransactionReceipt({ hash });
        toast(`${label} confirmed`, "ok", hash);
        return true;
      } catch (e: any) { toast(e?.shortMessage ?? e?.message ?? "Transaction failed", "bad"); return false; }
    },
    [wallet, toast, publicClient],
  );

  return { wallet, address: wallet?.address as Address | undefined, ready, write, sendUsdc, explorerTx };
}
