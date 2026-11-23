"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";

import { askAction } from "@/lib/actions/ask";
import { displayHost } from "@/lib/format";
import { safeHttpUrl } from "@/lib/documents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AskCitation, AskResponse } from "@/types/ask";

function CitationCard({
  citation,
  index,
  from,
}: {
  citation: AskCitation;
  index: number;
  from: string;
}) {
  const externalUrl = safeHttpUrl(citation.url);
  const detailHref = `/documents/${encodeURIComponent(citation.documentId)}?from=${encodeURIComponent(from)}`;

  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
      <span
        aria-hidden
        className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-brand/10 font-mono text-[11px] font-medium text-brand"
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={detailHref}
            className="min-w-0 rounded-sm text-sm font-medium text-foreground outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="block truncate">{citation.title}</span>
          </Link>
          {externalUrl ? (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open original at ${displayHost(externalUrl)}`}
              className="mt-0.5 shrink-0 rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground/80">
          {displayHost(citation.url)}
        </p>
        {citation.excerpt ? (
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {citation.excerpt}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function AnswerCard({ result }: { result: AskResponse }) {
  const insufficient = result.status === "insufficient_evidence";
  const totalMs = result.meta.retrievalMs + result.meta.generationMs;

  return (
    <article className="mt-8 text-left">
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Sparkles className="size-4 text-brand" aria-hidden />
            Answer
          </span>
          {insufficient ? (
            <Badge variant="secondary">Not enough evidence</Badge>
          ) : null}
        </div>
        <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-pretty text-foreground">
          {result.answer}
        </p>
      </div>

      {result.citations.length > 0 ? (
        <div className="mt-4">
          <h2 className="text-sm font-medium text-foreground">
            Citations
          </h2>
          <ol className="mt-2 space-y-2">
            {result.citations.map((citation, i) => (
              <CitationCard
                key={citation.chunkId ?? citation.documentId}
                citation={citation}
                index={i}
                from="/ask"
              />
            ))}
          </ol>
        </div>
      ) : null}

      <p className="mt-4 text-center font-mono text-xs text-muted-foreground/70">
        {result.meta.model} · {result.meta.retrievalMode} retrieval ·{" "}
        {totalMs}ms · {result.meta.promptTokens + result.meta.outputTokens}{" "}
        tokens
      </p>
    </article>
  );
}

export function AskPanel() {
  const [state, formAction, pending] = useActionState(askAction, {});

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="ask-question" className="sr-only">
          Question
        </label>
        <input
          id="ask-question"
          name="question"
          type="text"
          required
          maxLength={500}
          autoComplete="off"
          placeholder="e.g. How do Node.js streams handle backpressure?"
          className="h-11 flex-1 rounded-xl border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <Button type="submit" disabled={pending} className="h-11 px-6">
          {pending ? "Asking…" : "Ask"}
        </Button>
      </form>

      {state.error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}

      {state.result ? <AnswerCard result={state.result} /> : null}
    </div>
  );
}
