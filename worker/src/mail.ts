/** Hand-built MIME so the Worker has no dependencies. */

export type ApprovalMail = {
  from: string;
  to: string;
  inbound: string; // approve@<domain>
  id: string;
  amount: string;
  payee: string;
  memo: string;
  expiresAt: number;
  approveSubject: string;
  denySubject: string;
  freezeSubject: string;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const mailto = (inbound: string, subject: string) => `mailto:${inbound}?subject=${encodeURIComponent(subject)}`;
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/(.{76})/g, "$1\r\n");
const encSubject = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`);

export function mime(o: { from: string; to: string; subject: string; text: string; html: string; messageId?: string }): string {
  const boundary = `fala-${crypto.randomUUID()}`;
  const domain = o.from.split("@")[1] ?? "fala.invalid";
  return [
    `From: Fala <${o.from}>`,
    `To: ${o.to}`,
    `Subject: ${encSubject(o.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${o.messageId ?? crypto.randomUUID()}@${domain}>`,
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

export function approvalEmail(m: ApprovalMail): string {
  const subject = `[Fala] Approve ${m.amount} USDC to ${m.payee}? (#${m.id})`;
  const expires = new Date(m.expiresAt * 1000).toUTCString();
  const text = [
    `Your agent wants to pay ${m.amount} USDC to ${m.payee}.`,
    `For: ${m.memo || "(no memo)"}`,
    `Expires: ${expires}`,
    "",
    `To APPROVE, reply with (or send an email to ${m.inbound} with) the subject:`,
    `  ${m.approveSubject}`,
    `To DENY:   ${m.denySubject}`,
    `To FREEZE the vault: ${m.freezeSubject}`,
    "",
    "Only a message Google has DKIM-signed from your address can approve. The code binds this reply to this exact request.",
  ].join("\n");
  const btn = (href: string, label: string, bg: string) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 22px;border-radius:999px;background:${bg};color:#fff;text-decoration:none;font:500 15px -apple-system,Segoe UI,sans-serif">${label}</a>`;
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#0a0a0a;max-width:520px">
<div style="font:500 13px ui-monospace,Menlo,monospace;color:#7a7a7a">[ fala · approval needed ]</div>
<h2 style="font-weight:400;font-size:28px;letter-spacing:-.03em;margin:12px 0">Pay ${esc(m.amount)} USDC to ${esc(m.payee)}?</h2>
<p style="color:#555;margin:0 0 4px">“${esc(m.memo || "no memo")}”</p>
<p style="font:12.5px ui-monospace,Menlo,monospace;color:#7a7a7a;margin:0 0 20px">request #${esc(m.id)} · expires ${esc(expires)}</p>
${btn(mailto(m.inbound, m.approveSubject), "✅ Approve", "#18864b")}${btn(mailto(m.inbound, m.denySubject), "❌ Deny", "#0a0a0a")}${btn(mailto(m.inbound, m.freezeSubject), "🧊 Freeze", "#2563eb")}
<p style="font:12.5px/1.6 ui-monospace,Menlo,monospace;color:#7a7a7a;margin-top:18px">Tap a button, then press Send. Arc verifies Google's signature on your reply before any USDC moves.</p>
</div>`;
  return mime({ from: m.from, to: m.to, subject, text, html });
}

export function receiptEmail(o: { from: string; to: string; subject: string; body: string }): string {
  const html = `<pre style="font:14px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap;color:#0a0a0a">${esc(o.body)}</pre>`;
  return mime({ from: o.from, to: o.to, subject: o.subject, text: o.body, html });
}
