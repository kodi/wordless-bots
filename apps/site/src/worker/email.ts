// Outgoing mail (docs/ARCHITECTURE.md §12). Handlers depend on `EmailSender`, so tests use a fake and a
// Resend implementation could drop in behind it. Nothing here logs an address or a body.

/** Every message is sent from this address. */
export const SENDER_ADDRESS = "noreply@wordless.one";

export interface EmailSender {
  send(to: string, subject: string, text: string, html: string): Promise<void>;
}

/** Cloudflare Email Service, through the `send_email` binding. A refused send rejects. */
export function cloudflareEmail(binding: SendEmail): EmailSender {
  return {
    async send(to, subject, text, html) {
      await binding.send({ from: SENDER_ADDRESS, to, subject, text, html });
    },
  };
}

/** The recovery mail (§2.4): a plain text body and minimal HTML, each with the link and its expiry. */
export function recoveryMessage(
  link: string,
  ttlMinutes: number,
): { subject: string; text: string; html: string } {
  const expiry = `The link works once and expires in ${ttlMinutes} minutes.`;
  return {
    subject: "Recover your wordless.one API key",
    text: [
      "Someone asked to recover the API key of your bot on wordless.one.",
      "Open this link to get a new key. The old key stops working when you do:",
      "",
      link,
      "",
      expiry,
      "If this wasn't you, ignore this email and nothing changes.",
    ].join("\n"),
    html: [
      "<p>Someone asked to recover the API key of your bot on wordless.one.</p>",
      `<p><a href="${link}">Get a new API key</a>. The old key stops working when you do.</p>`,
      `<p>${expiry} If this wasn't you, ignore this email and nothing changes.</p>`,
    ].join("\n"),
  };
}
