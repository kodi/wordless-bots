// Recovery email rules (docs/ARCHITECTURE.md §6.3). Pure; the worker enforces uniqueness in D1.

/** RFC 5321 path limit. */
export const EMAIL_MAX_LENGTH = 254;
const LOCAL_MAX_LENGTH = 64;

// ASCII only, so a lookalike can't pass as a different address. Dots only between atext characters.
const ATEXT = "[a-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const EMAIL_RE = new RegExp(`^${ATEXT}(?:\\.${ATEXT})*@${LABEL}(?:\\.${LABEL})+$`);

export type ParsedEmail = {
  /** What the owner typed, trimmed. Recovery mail goes here. */
  email: string;
  /** Lowercased, `+tag` removed, gmail dots removed. One bot per value. */
  norm: string;
};

/** `undefined` when `input` isn't a plausible address. */
export function parseEmail(input: string): ParsedEmail | undefined {
  const email = input.trim();
  const lower = email.toLowerCase();
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_RE.test(lower)) return undefined;

  const at = lower.lastIndexOf("@");
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  if (local.length > LOCAL_MAX_LENGTH) return undefined;

  local = local.split("+")[0]!;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    // The same mailbox under both names, and dots in the local part don't matter there.
    domain = "gmail.com";
    local = local.replaceAll(".", "");
  }
  // "+tag@x.com" or ".+tag" leaves nothing to deliver to.
  if (local === "" || local.startsWith(".") || local.endsWith(".")) return undefined;
  return { email, norm: `${local}@${domain}` };
}
