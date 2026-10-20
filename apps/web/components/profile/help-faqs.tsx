"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ChevronDown, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import {
  AUDIENCE_LABEL,
  AUDIENCE_NOTE,
  AUDIENCE_ROLES,
  HELP_FAQS,
  type HelpAudience,
  type HelpFaq,
} from "@/lib/help-faqs";
import type { RoleName } from "@/lib/nav";

const ORDER: HelpAudience[] = ["everyone", "managers", "governance", "projects", "administrators"];

/**
 * The answers to the questions people actually ask, on the page they land on
 * when something has confused them.
 *
 * Relevance is a default, not a gate. Entries for roles you do not hold are
 * collapsed behind a toggle rather than removed: somebody about to take a desk
 * card should be able to read the manager answers first, and hiding them would
 * only mean they ask a person instead.
 *
 * Search looks at the answers too, not just the questions - people search for
 * the words they saw on screen ("blocked", "reviewer"), not for the question
 * somebody else thought to write.
 */
export function HelpFaqs({ roles }: { roles: RoleName[] }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const relevant = useMemo(() => {
    const held = new Set(roles);
    return (a: HelpAudience) =>
      a === "everyone" || AUDIENCE_ROLES[a].some((r) => held.has(r));
  }, [roles]);

  const q = query.trim().toLowerCase();
  const matches = (f: HelpFaq) =>
    !q ||
    f.question.toLowerCase().includes(q) ||
    f.answer.some((p) => p.toLowerCase().includes(q));

  // A search is an explicit request to look beyond your own role.
  const visible = HELP_FAQS.filter(
    (f) => matches(f) && (showAll || q.length > 0 || relevant(f.audience)),
  );

  const hiddenCount = HELP_FAQS.length - HELP_FAQS.filter((f) => relevant(f.audience)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search help"
            className="pl-8"
            placeholder="Search — try “blocked”, “reviewer”, “SLA”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {hiddenCount > 0 && !q && (
          <button
            type="button"
            className="text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show only what applies to me" : `Show all (${hiddenCount} more)`}
          </button>
        )}
      </div>

      {visible.length === 0 && (
        <p className="py-3 text-xs text-muted-foreground">
          Nothing matches “{query}”. Your department&apos;s workPulse helper is the next step —
          and a question that is not answered here is worth telling them about, so it can be.
        </p>
      )}

      {ORDER.map((audience) => {
        const group = visible.filter((f) => f.audience === audience);
        if (group.length === 0) return null;
        return (
          <section key={audience} className="flex flex-col gap-1.5">
            <div className="flex flex-col gap-0.5 pt-1">
              <div className="flex items-center gap-2">
                <span className="label-caps">{AUDIENCE_LABEL[audience]}</span>
                {!relevant(audience) && <Badge tone="neutral">not your role</Badge>}
              </div>
              {AUDIENCE_NOTE[audience] && (
                <span className="text-2xs text-muted-foreground">{AUDIENCE_NOTE[audience]}</span>
              )}
            </div>
            {group.map((faq) => (
              <FaqRow
                key={faq.id}
                faq={faq}
                isOpen={open === faq.id}
                onToggle={() => setOpen(open === faq.id ? null : faq.id)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function FaqRow({
  faq,
  isOpen,
  onToggle,
}: {
  faq: HelpFaq;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
      >
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
        <span className="font-medium">{faq.question}</span>
      </button>

      {isOpen && (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
          {faq.answer.map((para, i) => (
            <p key={i} className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {para}
            </p>
          ))}

          {faq.image && (
            <figure className="mt-1 flex max-w-2xl flex-col gap-1">
              <Image
                src={`/help/${faq.image.src}`}
                alt={faq.image.caption}
                width={799}
                height={544}
                className="rounded border border-border"
                // Help images are below the fold behind a disclosure, so they
                // should never compete with the page itself for bandwidth.
                loading="lazy"
                unoptimized
              />
              <figcaption className="text-2xs text-muted-foreground">{faq.image.caption}</figcaption>
            </figure>
          )}
        </div>
      )}
    </div>
  );
}
