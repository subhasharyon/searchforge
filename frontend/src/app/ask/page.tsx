import type { Metadata } from "next";

import { requireSession } from "@/lib/session";
import { AskPanel } from "./_components/ask-panel";

export const metadata: Metadata = {
  title: "Ask — SearchForge",
};

export default async function AskPage() {
  await requireSession("/ask");

  return (
    <section className="mx-auto w-full max-w-3xl flex-1 px-4 pt-10 pb-16 sm:px-6 sm:pt-14">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Ask the documentation
        </h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          A grounded answer built from retrieved passages — every claim cites
          a real source document.
        </p>
      </div>
      <AskPanel />
    </section>
  );
}
