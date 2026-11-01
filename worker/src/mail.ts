/** Hand-built MIME + table-based HTML so the Worker/relay has no dependencies and renders in every mail client. */

export type ApprovalMail = {
  from: string; // sender address (the relay mailbox)
  to: string; // the approver
  inbound: string; // where the reply goes (same mailbox)
  id: string;
  amount: string; // "2.00"
  payee: string; // label or short address
  payeeAddress?: string;
  memo: string;
  agent?: string; // label or short address
  vault?: string; // vault name
  expiresAt: number; // unix seconds
  approveSubject: string;
  denySubject: string;
  freezeSubject: string;
};

export type ReceiptKind = "paid" | "denied" | "frozen" | "expired" | "failed" | "refused" | "duplicate";
export type ReceiptMail = {
  from: string;
  to: string;
  kind: ReceiptKind;
  amount?: string;
  payee?: string;
  memo?: string;
  id?: string;
  explorerUrl?: string;
  detail?: string;
  status?: string; // for "duplicate": the request's earlier outcome (APPROVED, DENIED, ...)
};

const INK = "#0a0a0a";
const MUTE = "#6b6b6b";
const LINE = "#e7e7e9";
const GREEN = "#18864b";
const RED = "#d92d20";
const BLUE = "#2563eb";
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
/** The six-dot mark built from text, since mail clients block SVG and hosted images. */
const dots = (n: number) => Array(n).fill("●").join("&nbsp;");
const LOGO = `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="font:7px/7px Arial,sans-serif;color:#0a0a0a;padding-right:8px;">${dots(3)}<br>${dots(2)}<br>${dots(1)}</td><td style="font:600 17px ${FONT};letter-spacing:.04em;color:#0a0a0a;">FALA</td></tr></table>`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string) => btoa(String.fromCharCode(...utf8(s))).replace(/(.{76})/g, "$1\r\n");
const encHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(String.fromCharCode(...utf8(s)))}?=`);
const money = (a: string) => `${a} USDC`;

const mailto = (to: string, subject: string, body: string) =>
  `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** "in 59 minutes", "in 3 days" + the absolute UTC time. */
export function friendlyExpiry(expiresAt: number, now = Math.floor(Date.now() / 1000)): string {
  const s = expiresAt - now;
  const abs = new Date(expiresAt * 1000).toUTCString().replace(/ GMT$/, " UTC").replace(/:\d\d UTC$/, " UTC");
  if (s <= 0) return `expired (${abs})`;
  const m = Math.round(s / 60);
  const rel = m < 60 ? `in ${m} minute${m === 1 ? "" : "s"}` : m < 60 * 36 ? `in ${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? "" : "s"}` : `in ${Math.round(m / 1440)} days`;
  return `${rel} (${abs})`;
}

export function mime(o: { from: string; fromName?: string; to: string; subject: string; text: string; html: string }): string {
  const boundary = `fala-${crypto.randomUUID()}`;
  const domain = o.from.split("@")[1] ?? "fala.invalid";
  const name = o.fromName ? `${encHeader(o.fromName)} ` : "";
  return [
    `From: ${name}<${o.from}>`,
    `To: ${o.to}`,
    `Subject: ${encHeader(o.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(o.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(o.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Shared card layout (600px, table-based, inline styles). */
export function layout(o: { preheader: string; eyebrow: string; title: string; body: string; footer: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f4f5;">${esc(o.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
  <tr><td style="padding:0 4px 14px 4px;color:${INK};">${LOGO}</td></tr>
  <tr><td style="background:#ffffff;border-radius:20px;border:1px solid ${LINE};padding:34px 34px 30px 34px;font-family:${FONT};color:${INK};">
    <div style="font:500 13px ${FONT};color:${MUTE};">${esc(o.eyebrow)}</div>
    <h1 style="margin:10px 0 0 0;font:400 28px/1.15 ${FONT};letter-spacing:-.02em;color:${INK};">${o.title}</h1>
    ${o.body}
  </td></tr>
  <tr><td style="padding:18px 8px 0 8px;font:12.5px/1.6 ${FONT};color:${MUTE};">${o.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

export const row = (k: string, v: string) =>
  `<tr><td style="padding:9px 0;border-top:1px solid ${LINE};font:13px ${FONT};color:${MUTE};width:96px;vertical-align:top;">${k}</td><td style="padding:9px 0;border-top:1px solid ${LINE};font:14.5px/1.45 ${FONT};color:${INK};">${v}</td></tr>`;

export const button = (href: string, label: string, bg: string, fg = "#ffffff", border = bg) =>
  `<td style="padding:0 10px 10px 0;"><a href="${esc(href)}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:${bg};border:1px solid ${border};color:${fg};font:600 15px ${FONT};text-decoration:none;">${label}</a></td>`;

export function approvalSubject(m: Pick<ApprovalMail, "amount" | "payee" | "id">) {
  return `Approve ${money(m.amount)} to ${m.payee}? (Request #${m.id})`;
}

export function approvalEmail(m: ApprovalMail): string {
  const expires = friendlyExpiry(m.expiresAt);
  const who = m.agent ? `Your agent <b>${esc(m.agent)}</b>` : "Your agent";
  const approveBody = `Yes, please go ahead and pay ${money(m.amount)} to ${m.payee}.\n\nJust press Send. The subject line ties this reply to request #${m.id}, so leave it as it is.`;
  const denyBody = `No, please don't pay this one (request #${m.id}).\n\nJust press Send. Leave the subject line as it is.`;
  const freezeBody = `Please freeze the vault so no agent can spend until I unfreeze it.\n\nJust press Send. Leave the subject line as it is.`;

  const body = `
    <div style="margin:22px 0 4px 0;font:400 44px/1 ${FONT};letter-spacing:-.03em;color:${INK};">${esc(m.amount)} <span style="font:500 16px ${FONT};color:${MUTE};letter-spacing:0;">USDC</span></div>
    <p style="margin:14px 0 22px 0;font:15px/1.6 ${FONT};color:#3a3a3a;">${who} would like to pay <b>${esc(m.payee)}</b>. Nothing moves until you say yes.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
      ${row("Pay to", `${esc(m.payee)}${m.payeeAddress ? ` <span style="font:12px ${MONO};color:${MUTE};">${esc(m.payeeAddress)}</span>` : ""}`)}
      ${row("For", m.memo ? `“${esc(m.memo)}”` : `<span style="color:${MUTE};">No note provided</span>`)}
      ${m.vault ? row("Vault", esc(m.vault)) : ""}
      ${row("Request", `#${esc(m.id)}`)}
      ${row("Expires", esc(expires))}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      ${button(mailto(m.inbound, m.approveSubject, approveBody), "Approve payment", GREEN)}
      ${button(mailto(m.inbound, m.denySubject, denyBody), "Deny", "#ffffff", INK, "#cfcfd3")}
    </tr></table>
    <p style="margin:6px 0 0 0;font:13px/1.6 ${FONT};color:${MUTE};">Each button opens a ready reply in Gmail. Just press <b>Send</b>.</p>

    <div style="margin:26px 0 0 0;padding:16px 20px;background:#f7f7f8;border-radius:14px;font:13.5px/1.6 ${FONT};color:#3a3a3a;">
      Google signs your reply, and Arc checks that signature before any money moves. Nobody can approve for you, not even the agent.
    </div>

    <p style="margin:22px 0 0 0;font:13px/1.6 ${FONT};color:${MUTE};">Something look wrong? Just tap <b>Deny</b>, or <a href="${esc(mailto(m.inbound, m.freezeSubject, freezeBody))}" style="color:${BLUE};">freeze the vault</a> to stop every agent immediately.</p>`;

  const text = [
    `Approve ${money(m.amount)} to ${m.payee}?`,
    "",
    `${m.agent ? `Your agent ${m.agent}` : "Your agent"} would like to pay ${m.payee}. Nothing moves until you say yes.`,
    "",
    `  Pay to:   ${m.payee}${m.payeeAddress ? ` (${m.payeeAddress})` : ""}`,
    `  For:      ${m.memo || "(no note)"}`,
    ...(m.vault ? [`  Vault:    ${m.vault}`] : []),
    `  Request:  #${m.id}`,
    `  Expires:  ${expires}`,
    "",
    "TO APPROVE: reply to this email's sender with exactly this subject, then press Send:",
    `  ${m.approveSubject}`,
    "",
    "TO DENY:",
    `  ${m.denySubject}`,
    "",
    `Stop everything: ${m.freezeSubject}`,
    "",
    "Why the code? It links your reply to this one payment so it can't be reused. Google signs your email and the Arc blockchain verifies that signature before any money moves.",
  ].join("\n");

  return mime({
    from: m.from,
    fromName: "Fala Approvals",
    to: m.to,
    subject: approvalSubject(m),
    text,
    html: layout({
      preheader: `${m.agent ?? "Your agent"} wants to pay ${m.payee}. Tap Approve, then Send. Nothing moves until you do.`,
      eyebrow: "Approval needed",
      title: "Approve this payment?",
      body,
      footer: `You're receiving this because ${esc(m.to)} is the approver for this vault. Fala never asks for your password or keys. If you weren't expecting this, tap Deny.`,
    }),
  });
}

const RECEIPT: Record<ReceiptKind, { icon: string; color: string; subject: (r: ReceiptMail) => string; title: (r: ReceiptMail) => string; lead: (r: ReceiptMail) => string }> = {
  paid: {
    icon: "✓", color: GREEN,
    subject: (r) => `Payment sent: ${money(r.amount ?? "")} to ${r.payee} ✓`,
    title: () => "Payment sent",
    lead: (r) => `${money(r.amount ?? "")} has been sent to ${r.payee}. Arc verified Google's signature on your reply before releasing it.`,
  },
  denied: {
    icon: "✕", color: INK,
    subject: (r) => `You denied the ${money(r.amount ?? "")} payment to ${r.payee}`,
    title: () => "Payment denied",
    lead: (r) => `Request #${r.id} will not be paid, and no money moved.`,
  },
  frozen: {
    icon: "❄", color: BLUE,
    subject: () => "Vault frozen: agents can't spend until you unfreeze it",
    title: () => "Vault frozen",
    lead: () => "Every agent on this vault is stopped. Only the vault owner can unfreeze it from the Fala dashboard.",
  },
  expired: {
    icon: "⌛", color: MUTE,
    subject: () => "That payment request had already expired",
    title: () => "Request expired",
    lead: (r) => `Request #${r.id} ran out of time before your reply arrived, so it was closed instead of paid. Ask the agent to try again.`,
  },
  failed: {
    icon: "!", color: "#b86e00",
    subject: (r) => `Approved, but the ${money(r.amount ?? "")} payment couldn't be sent`,
    title: () => "Approved, but it couldn't be sent",
    lead: () => "The vault may be underfunded or the payee blocked. Your funds stay safely in the vault, and this request is now closed. Top up the vault and ask the agent to try again.",
  },
  duplicate: {
    icon: "ℹ", color: MUTE,
    subject: (r) => `Already handled: request #${r.id}`,
    title: () => "Already taken care of",
    lead: (r) => {
      const what = r.amount ? `the ${money(r.amount)} payment${r.payee ? ` to ${r.payee}` : ""}` : "this payment";
      switch (r.status) {
        case "APPROVED": return `Request #${r.id} was already approved, and ${what} was sent earlier. There's no need to reply again.`;
        case "DENIED": return `Request #${r.id} was already denied, so ${what} was not made. There's no need to reply again.`;
        case "EXPIRED": return `Request #${r.id} expired before it was answered, so ${what} was not made.`;
        case "CANCELLED": return `Request #${r.id} was cancelled, so ${what} was not made.`;
        case "FAILED": return `Request #${r.id} was approved earlier, but ${what} couldn't be sent. The funds stayed in the vault.`;
        default: return `Request #${r.id} has already been handled. There's no need to reply again.`;
      }
    },
  },
  refused: {
    icon: "!", color: RED,
    subject: () => "We couldn't process that reply",
    title: () => "We couldn't process that reply",
    lead: (r) => r.detail ?? "The vault refused it, so nothing was sent.",
  },
};

export function receiptEmail(r: ReceiptMail): string {
  const k = RECEIPT[r.kind];
  const body = `
    <p style="margin:16px 0 22px 0;font:15px/1.65 ${FONT};color:#3a3a3a;">${esc(k.lead(r))}</p>
    ${r.amount || r.payee || r.memo || r.id
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px 0;">
      ${r.amount ? row("Amount", `${esc(r.amount)} USDC`) : ""}${r.payee ? row("Paid to", esc(r.payee)) : ""}${r.memo ? row("For", `“${esc(r.memo)}”`) : ""}${r.id ? row("Request", `#${esc(r.id)}`) : ""}
    </table>` : ""}
    ${r.explorerUrl ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${button(r.explorerUrl, "View the transaction", "#ffffff", INK, "#cfcfd3")}</tr></table>` : ""}`;
  const text = [k.title(r), "", k.lead(r), "", ...(r.amount ? [`Amount: ${r.amount} USDC`] : []), ...(r.payee ? [`Paid to: ${r.payee}`] : []), ...(r.memo ? [`For: ${r.memo}`] : []), ...(r.explorerUrl ? ["", `Transaction: ${r.explorerUrl}`] : [])].join("\n");
  return mime({
    from: r.from,
    fromName: "Fala Approvals",
    to: r.to,
    subject: k.subject(r),
    text,
    html: layout({
      preheader: k.lead(r),
      eyebrow: r.kind === "refused" || r.kind === "failed" ? "Heads up" : r.kind === "duplicate" ? "No action needed" : "Update",
      title: `<span style="color:${k.color};">${k.icon}</span>&nbsp;${esc(k.title(r))}`,
      body,
      footer: "You're getting this receipt because you replied to a Fala approval request. Nothing else is needed.",
    }),
  });
}

export type LowBalanceMail = { from: string; to: string; vault: string; balance: string; minimum: string; shortfall: string; vaultAddress: string; dashboardUrl: string };

export function lowBalanceEmail(m: LowBalanceMail): string {
  const body = `
    <p style="margin:16px 0 22px 0;font:15px/1.65 ${FONT};color:#3a3a3a;">Your vault <b>${esc(m.vault)}</b> has dropped below the minimum balance you set, so your agents may soon be unable to pay. Top it up to keep them running.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px 0;">
      ${row("Balance", `${esc(m.balance)} USDC`)}${row("Minimum", `${esc(m.minimum)} USDC`)}${row("Needed", `<b>${esc(m.shortfall)} USDC</b> to get back to your minimum`)}
      ${row("Vault", `<span style="font:12px ${MONO};">${esc(m.vaultAddress)}</span>`)}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>${button(m.dashboardUrl, "Top up in Fala", INK)}</tr></table>`;
  const text = [`Your vault "${m.vault}" is below its minimum balance.`, "", `Balance: ${m.balance} USDC`, `Minimum: ${m.minimum} USDC`, `Needed:  ${m.shortfall} USDC`, "", `Top up: ${m.dashboardUrl}`].join("\n");
  return mime({ from: m.from, fromName: "Fala", to: m.to, subject: `Top up needed: ${m.vault} is below its minimum`, text,
    html: layout({ preheader: `${m.vault} has ${m.balance} USDC, below your ${m.minimum} USDC minimum.`, eyebrow: "Heads up", title: "Your vault needs funds", body,
      footer: "You're getting this because you set a minimum balance for this vault. You'll hear about it at most once a day. Change the minimum in the vault's settings." }) });
}
