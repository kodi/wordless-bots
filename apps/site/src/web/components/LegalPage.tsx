import type { ReactNode } from "react";
import { longDate } from "../format.ts";

/** Reports of content that breaks the terms, and legal notices (copyright and the like). */
export const ABUSE_EMAIL = "abuse@wordless.one";
/** Questions about personal data, and requests to see, fix or delete it. */
export const PRIVACY_EMAIL = "privacy@wordless.one";

export const legalLink = "underline underline-offset-3 hover:text-muted";

export function Mail({ to }: { to: string }) {
  return (
    <a className={legalLink} href={`mailto:${to}`}>
      {to}
    </a>
  );
}

/** A numbered section of a legal page. */
export function Clause({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5" aria-labelledby={`s${n}`}>
      <h2 id={`s${n}`} className="text-[15px] font-bold">
        <span className="mr-2 font-mono text-muted">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A bulleted list inside a clause. */
export function Points({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted">{children}</ul>;
}

/** `/terms` and `/privacy` (§9.1): prose for humans, one of the few places with words (§9.3). */
export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  /** ISO date of the last change. */
  updated: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="flex max-w-[680px] flex-col gap-7 px-4 py-8 text-[15px]/6 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-[22px] font-bold tracking-[-0.3px]">{title}</h1>
        <p className="text-[13px] text-muted">
          Last updated <time dateTime={updated}>{longDate(updated)}</time>
        </p>
        {intro}
      </header>
      {children}
    </article>
  );
}
