import { useEffect, useState } from "react";

/** How long the button shows `✓`. */
const COPIED_MS = 2000;

/** `⧉`, which copies `text` and shows `✓` for a moment. Sits in the top-right corner of a `relative` box. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => {}, // No clipboard (an insecure origin, a denied permission): the text is there to select.
    );
  };

  return (
    <button
      type="button"
      className="absolute top-1.5 right-1.5 grid size-7 cursor-pointer place-items-center text-muted select-none hover:text-ink"
      title={copied ? "Copied" : "Copy"}
      aria-label={copied ? "Copied" : label}
      onClick={copy}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}
