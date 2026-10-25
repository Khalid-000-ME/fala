/** End-to-end on the configured network: configure, fund, auto-pay, queue, approve by (stand-in) email. */
import { parseEmail, bytesToHex } from "../../../src/lib/dkim.js";
import { addressOf, allowance, checkEmail, intent, publicClient, requestPayment, subjectFor, submitEmail, write } from "../lib/fala.js";
import { vendors } from "../lib/config.js";
import { signStandin } from "./standin.js";
import { fromUsdc6 } from "../lib/units.js";

const log = (...a: unknown[]) => console.log(...a);
const vendor = vendors().VENDOR_A;
const bal = async (a: `0x${string}`) => fromUsdc6((await publicClient.readContract({ address: "0x3600000000000000000000000000000000000000", abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [a] })) as bigint);

log("▶ configure");
await write("owner", "setAgent", [addressOf("agent"), 200_000n, 1_000_000n, 5_000_000n, true]);
await write("owner", "setPayee", [vendor, true]);
const before = (await allowance()).vaultBalance;
const dep = await write("owner", "deposit", [], 3n * 10n ** 18n);
log(`  deposit(3 USDC, payable): vault ${before} -> ${(await allowance()).vaultBalance}  ${dep.hash}`);

log("▶ auto-paid 0.10 to a known vendor");
const v0 = await bal(vendor);
const auto = await requestPayment(vendor, "0.10", "dataset: eu-weather-2026");
log(`  ${auto.status}  vendor +${Number(await bal(vendor)) - Number(v0)}  ${auto.txHash}`);

log("▶ 2.00 needs the human");
const ask = await requestPayment(vendor, "2.00", "annual API plan");
log(`  ${ask.status} intent #${ask.intentId}  ${ask.txHash}`);
const id = BigInt(ask.intentId!);
const subject = await subjectFor(id, 1);
log(`  reply subject: "${subject}"`);

log("▶ the human replies (stand-in Gmail signature)");
const eml = await signStandin({ subject });
const p = parseEmail(eml);
const hb = bytesToHex(p.headerBlock);
const sg = bytesToHex(p.sig);
log(`  d=${p.d} s=${p.s} from=${p.from} t=${p.t}  block ${p.headerBlock.length} bytes`);
const chk = await checkEmail(hb, sg);
log(`  checkEmail (eth_call): verb=${chk.verb} id=${chk.id}`);

const v1 = await bal(vendor);
const out = await submitEmail(hb, sg);
log(`  ${out.verb} paid=${out.paid}  gas ${out.gasUsed}  vendor +${Number(await bal(vendor)) - Number(v1)}  ${out.txHash}`);
log(`  intent #${id}:`, (await intent(id)).status);
