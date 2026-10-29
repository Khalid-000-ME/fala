/** One plain-words line per named contract error — the "refusal room" vocabulary. */
export const REFUSALS: Record<string, string> = {
  MalformedHeader: "The signed header block isn't well-formed, so it can't be read safely.",
  DkimNotLast: "The DKIM-Signature header isn't the last line of the signed block, so the block can't be the one Google signed.",
  DuplicateHeader: "A header that must appear exactly once (From, Subject or DKIM-Signature) appears more than once — a classic spoofing trick.",
  MissingHeader: "The signed block has no From or no Subject header.",
  HeaderNotSigned: "Google's signature doesn't cover both the From and Subject headers, so they could have been swapped in.",
  WrongAlgorithm: "The signature isn't rsa-sha256 — weaker or different algorithms are refused.",
  WrongCanonicalization: "The signature wasn't made with relaxed header canonicalization, which is the only form Fala checks.",
  BadFrom: "The From header isn't a single plain email address (extra addresses or odd characters).",
  UnknownKey: "No registered DKIM key matches this domain and selector.",
  KeyRevoked: "That DKIM key was revoked by the owner and is no longer trusted.",
  KeyNotActive: "That DKIM key was proposed recently and is still inside its safety timelock.",
  BadSignature: "The RSA signature doesn't match these headers. Something changed after Google signed it, or it wasn't signed by this key.",
  FromNotApprover: "The signature is genuine, but the sender isn't the approver address registered in this vault.",
  DomainMismatch: "The From address belongs to a different domain than the one that signed the email.",
  SubjectMalformed: "The subject isn't exactly `FALA APPROVE|DENY <id> <code>` (or `FALA FREEZE 0 <code>`).",
  IntentNotPending: "That payment request is no longer waiting — it was already approved, denied, cancelled or expired. An email can only be used once.",
  IntentExpired: "That payment request ran out of time before the reply arrived.",
  CodeMismatch: "The code in the subject doesn't match this exact payment request (amount, payee, vault, chain).",
  StaleTimestamp: "The email was signed at the wrong time for this request: before it existed, after it expired, or older than the last freeze.",
  Frozen: "The vault is frozen. Only the owner can unfreeze it.",
  UseDeposit: "Plain transfers are refused; use deposit().",
};

export const refusalText = (name: string) => REFUSALS[name] ?? name;
