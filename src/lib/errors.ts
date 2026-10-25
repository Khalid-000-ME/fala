import { BaseError, ContractFunctionRevertedError } from "viem";

/** The contract's named error (e.g. "BadSignature") from a failed call, else a readable message. */
export function errorName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? r.shortMessage;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
