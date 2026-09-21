"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type StatusFilter = "OPEN" | "REVIEWED_ACCEPTED" | "REVIEWED_DISMISSED";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "REVIEWED_ACCEPTED", label: "Upheld" },
  { value: "REVIEWED_DISMISSED", label: "Dismissed" },
];

export default function FlagsPage() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<StatusFilter>("OPEN");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const flags = trpc.flag.list.useQuery({ status });

  const review = trpc.flag.review.useMutation({
    onSuccess: () => {
      setReviewing(null);
      setNote("");
      setError(null);
      utils.flag.list.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (flags.error) {
    const code = flags.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "UNAUTHORIZED" ? "Sign in to continue" : code === "FORBIDDEN" ? "Not available to your role" : "Could not load flags"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN"
            ? "Reviewing flags is limited to department heads, Audit and executives."
            : flags.error.message}
        </p>
      </Card>
    );
  }

  const rows = flags.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">{error}</div>
      )}

      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={status === f.value ? "primary" : "ghost"}
            onClick={() => {
              setStatus(f.value);
              setReviewing(null);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((f) => (
          <Card key={f.id}>
            <CardContent className="flex flex-col gap-3 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={f.status === "OPEN" ? "warning" : f.status === "REVIEWED_ACCEPTED" ? "danger" : "neutral"}>
                  {f.flagType.replace(/_/g, " ").toLowerCase()}
                </Badge>
                {f.subjectEmployee && <span className="text-sm font-medium">{f.subjectEmployee.name}</span>}
                {f.task && (
                  <Link href={`/tasks/${f.task.id}`} className="text-xs tabular text-muted-foreground hover:underline">
                    {f.task.reference}
                  </Link>
                )}
                <span className="ml-auto text-2xs text-muted-foreground tabular">
                  {new Date(f.createdAt).toLocaleDateString()}
                </span>
              </div>

              <p className="text-xs">{f.detail}</p>

              {f.windowStart && f.windowEnd && (
                <p className="text-2xs text-muted-foreground tabular">
                  Window examined: {new Date(f.windowStart).toLocaleDateString()} –{" "}
                  {new Date(f.windowEnd).toLocaleDateString()}
                </p>
              )}

              {f.status !== "OPEN" && f.reviewNote && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                  <p className="text-2xs text-muted-foreground">
                    {f.status === "REVIEWED_ACCEPTED" ? "Upheld" : "Dismissed"}
                    {f.reviewedAt ? ` on ${new Date(f.reviewedAt).toLocaleDateString()}` : ""}: {f.reviewNote}
                  </p>
                </div>
              )}

              {f.status === "OPEN" &&
                (reviewing === f.id ? (
                  <div className="flex flex-col gap-2">
                    <Field label="Review note" htmlFor={`note-${f.id}`}>
                      <Textarea
                        id={`note-${f.id}`}
                        rows={3}
                        value={note}
                        placeholder="What you checked and what you concluded."
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </Field>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={review.isPending || !note.trim()}
                        onClick={() => review.mutate({ flagId: f.id, decision: "DISMISS", note })}
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        disabled={review.isPending || !note.trim()}
                        onClick={() => review.mutate({ flagId: f.id, decision: "ACCEPT", note })}
                      >
                        Uphold
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setReviewing(null); setNote(""); }}>
                        Cancel
                      </Button>
                      <span className="text-2xs text-muted-foreground">A note is required either way.</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => { setReviewing(f.id); setNote(""); }}>
                      Review
                    </Button>
                  </div>
                ))}
            </CardContent>
          </Card>
        ))}

        {!flags.isLoading && rows.length === 0 && (
          <Card className={cn("flex flex-col items-center gap-2 px-6 py-14 text-center")}>
            <p className="text-sm font-medium">Nothing here</p>
            <p className="max-w-md text-xs text-muted-foreground">
              {status === "OPEN"
                ? "No flags are waiting on a decision."
                : "No flags have been decided this way yet."}
            </p>
          </Card>
        )}
      </div>

      <p className="text-2xs text-muted-foreground">
        A flag is a prompt to look, never a penalty. While a flag is open the work behind it is excluded
        from the employee&apos;s figures entirely — dismissing it puts the work straight back.
      </p>
    </div>
  );
}
