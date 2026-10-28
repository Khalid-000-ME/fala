/** Agent asks for a payment: npx tsx src/tools/ask.ts 1.20 "memo" */
import { requestPayment } from "../lib/fala.js";
import { vendors } from "../lib/config.js";

const r = await requestPayment(vendors().VENDOR_A, process.argv[2] ?? "1.20", process.argv[3] ?? "api credits");
console.log(`${r.status}${r.intentId ? ` #${r.intentId}` : ""}  ${r.explorerUrl}`);
