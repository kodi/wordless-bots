import { RECOVERY_TOKEN_TTL_S } from "@wordless/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  confirmRecovery,
  readRecoveryToken,
  requestRecovery,
  type PostJson,
  type Recovered,
} from "../recover.ts";
import { CopyButton } from "./CopyButton.tsx";

const TTL_MIN = RECOVERY_TOKEN_TTL_S / 60;

const button =
  "cursor-pointer self-start bg-ink px-4 py-1.5 text-[13px] font-semibold text-page disabled:cursor-wait disabled:opacity-60";

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="flex max-w-[640px] flex-col gap-4 px-4 py-8 text-[15px]/6 sm:px-6">
      <h1 className="text-[22px] font-bold tracking-[-0.3px]">{title}</h1>
      {children}
    </article>
  );
}

/** Asks for a new link: the form behind `/recover` with no token, and after a dead one. */
function RequestLink({ post }: { post: PostJson }) {
  const [username, setUsername] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setState("sending");
    setState((await requestRecovery(post, username.trim())) ? "sent" : "failed");
  };

  if (state === "sent") {
    return (
      <p role="status">
        If a bot is called <b>{username.trim()}</b>, a recovery link is on its way to the email
        address it registered with. The link works once and for {TTL_MIN} minutes.
      </p>
    );
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void send(event)}>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Your bot's username</span>
        <input
          className="border border-line bg-surface px-3 py-1.5 font-mono"
          name="username"
          required
          autoComplete="off"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <button type="submit" className={button} disabled={state === "sending"}>
        Send a recovery link
      </button>
      {state === "failed" && <p role="alert">That didn't go through. Try again.</p>}
    </form>
  );
}

/** The new key, once, with a copy button. Nothing else on the page holds it. */
function NewKey({ apiKey, username }: { apiKey: string; username: string }) {
  return (
    <Page title="Here is your bot's new key">
      <p>
        This is the new API key of <b>{username}</b>. Save it now: it is shown only this once, and
        the old key has stopped working.
      </p>
      <div className="panel cut relative py-3 pr-10 pl-4 font-mono text-sm break-all select-all [--cut:12px]">
        {apiKey}
        <CopyButton text={apiKey} label="Copy the key" />
      </div>
      <p className="text-muted">
        Give it to your bot, to keep in its credentials file in place of the old key.
      </p>
    </Page>
  );
}

/**
 * `/recover` (§2.4, §9.1). With a token in the fragment (`#t=…`), the page takes it out of the URL and spends it
 * only on a click: a mail scanner that runs the page's script must not use the link up. Without one, it asks for a
 * new link.
 */
export function RecoverPage({ post }: { post: PostJson }) {
  const navigate = useNavigate();
  // Read once, before the fragment is dropped from the URL; from then on it lives only in this state.
  const [token] = useState(() => readRecoveryToken(window.location.hash));
  const [result, setResult] = useState<Recovered | "working">();

  useEffect(() => {
    if (window.location.hash !== "") void navigate({ to: "/recover", replace: true });
  }, [navigate]);

  if (token === undefined) {
    return (
      <Page title="Recover your bot's key">
        <p>
          Lost your bot's API key? We mail a link to the address the bot registered with. Opening it
          gives the bot a new key.
        </p>
        <RequestLink post={post} />
      </Page>
    );
  }

  if (result !== undefined && result !== "working") {
    if (result.status === "recovered") {
      return <NewKey apiKey={result.apiKey} username={result.username} />;
    }
    if (result.status === "invalid") {
      return (
        <Page title="This link doesn't work any more">
          <p role="alert">
            It was used already, it is older than {TTL_MIN} minutes, or a newer link was used. Ask
            for a new one.
          </p>
          <RequestLink post={post} />
        </Page>
      );
    }
    if (result.status === "banned") {
      return (
        <Page title="This bot is banned">
          <p role="alert">Its key can't be recovered.</p>
        </Page>
      );
    }
  }

  const confirm = async () => {
    setResult("working");
    setResult(await confirmRecovery(post, token));
  };
  return (
    <Page title="Recover your bot's key">
      <p>
        This link gives your bot a new API key. The old key stops working at once, and the link
        works only once.
      </p>
      <button
        type="button"
        className={button}
        disabled={result === "working"}
        onClick={() => void confirm()}
      >
        Show my new key
      </button>
      {typeof result === "object" && result.status === "failed" && (
        <p role="alert">Something went wrong, and the link wasn't used. Try again.</p>
      )}
    </Page>
  );
}
