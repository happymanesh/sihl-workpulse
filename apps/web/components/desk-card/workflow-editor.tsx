"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

type Step = { title: string; expectedMinutes?: number };

/**
 * The procedure an activity's work must follow.
 *
 * This exists because a verified task type cannot be approved without an
 * approved workflow — the steps are what a reviewer checks against, so "did
 * they follow the procedure" has an answer. Without this screen the whole
 * compliance half of workPulse was unreachable: the rule was enforced and
 * nothing could satisfy it.
 *
 * Versions, not edits. An approved version is immutable and is superseded
 * rather than replaced, because tasks are pinned to the version in force when
 * they were generated and must keep resolving to the steps that actually
 * applied.
 */
export function WorkflowEditor({
  activityId,
  activityTitle,
  onError,
}: {
  activityId: string;
  activityTitle: string;
  onError: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const workflow = trpc.workflow.forActivity.useQuery({ activityId });

  const versions = workflow.data?.versions ?? [];
  const approved = versions.find((v) => v.status === "APPROVED");
  const draft = versions.find((v) => v.status === "DRAFT");

  const [steps, setSteps] = useState<Step[] | null>(null);

  const refresh = () => {
    utils.workflow.forActivity.invalidate({ activityId });
    utils.deskCard.byId.invalidate();
  };

  const createDraft = trpc.workflow.createDraft.useMutation({
    onSuccess: () => {
      setSteps(null);
      refresh();
    },
    onError: (e) => onError(e.message),
  });
  const editDraft = trpc.workflow.editDraft.useMutation({
    onSuccess: () => {
      setSteps(null);
      refresh();
    },
    onError: (e) => onError(e.message),
  });
  const approve = trpc.workflow.approve.useMutation({
    onSuccess: refresh,
    onError: (e) => onError(e.message),
  });

  // Editing starts from the draft if there is one, otherwise from the approved
  // version — revising a procedure almost always means changing a step or two
  // of the one in force, not writing it again from nothing.
  const startEditing = () => {
    const source = draft ?? approved;
    setSteps(
      source
        ? source.steps.map((s) => ({ title: s.title, expectedMinutes: s.expectedMinutes ?? undefined }))
        : [{ title: "" }],
    );
  };

  const save = () => {
    const clean = (steps ?? [])
      .map((s) => ({ title: s.title.trim(), expectedMinutes: s.expectedMinutes }))
      .filter((s) => s.title.length >= 2);
    if (clean.length === 0) {
      onError("A workflow needs at least one step with a name");
      return;
    }
    if (draft) editDraft.mutate({ versionId: draft.id, steps: clean });
    else createDraft.mutate({ activityId, steps: clean });
  };

  const busy = createDraft.isPending || editDraft.isPending || approve.isPending;

  return (
    <tr className="border-b border-border bg-muted/30 last:border-b-0">
      <td colSpan={8} className="px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-caps">Procedure — {activityTitle}</span>
            {approved && <Badge tone="success">v{approved.versionNumber} in force</Badge>}
            {draft && <Badge tone="warning">v{draft.versionNumber} draft</Badge>}
            {!approved && !draft && <Badge tone="neutral">none yet</Badge>}
            {approved?.reviewDueAt && (
              <span className="text-2xs text-muted-foreground">
                review due {new Date(approved.reviewDueAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {workflow.isLoading && <div className="h-16 animate-pulse rounded-md bg-muted" />}

          {/* The version in force, read-only. */}
          {approved && steps === null && (
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              {approved.steps.map((s) => (
                <li key={s.id} className="text-xs">
                  {s.title}
                  {s.expectedMinutes ? (
                    <span className="text-muted-foreground"> · {s.expectedMinutes}m</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          {!approved && !draft && steps === null && (
            <p className="max-w-prose text-2xs text-muted-foreground">
              No procedure yet. A task type that requires verification cannot be approved without
              one — the steps are what the reviewer checks against.
            </p>
          )}

          {draft && steps === null && (
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              {draft.steps.map((s) => (
                <li key={s.id} className="text-xs text-muted-foreground">
                  {s.title}
                  {s.expectedMinutes ? ` · ${s.expectedMinutes}m` : ""}
                </li>
              ))}
            </ol>
          )}

          {/* The editor. */}
          {steps !== null && (
            <div className="flex flex-col gap-2">
              {steps.map((s, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <span className="w-5 pb-2 text-right text-2xs text-muted-foreground">{i + 1}.</span>
                  <Field label={i === 0 ? "Step" : ""} htmlFor={`st-${i}`} className="min-w-64 flex-1">
                    <Input
                      id={`st-${i}`}
                      value={s.title}
                      placeholder="What the performer does, specifically"
                      onChange={(e) =>
                        setSteps(steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                      }
                    />
                  </Field>
                  <Field label={i === 0 ? "Minutes" : ""} htmlFor={`sm-${i}`} className="w-24">
                    <Input
                      id={`sm-${i}`}
                      type="number"
                      min={1}
                      value={s.expectedMinutes ?? ""}
                      onChange={(e) =>
                        setSteps(
                          steps.map((x, j) =>
                            j === i
                              ? { ...x, expectedMinutes: e.target.value ? Number(e.target.value) : undefined }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <div className="flex gap-0.5 pb-1">
                    <button
                      type="button"
                      title="Move up"
                      disabled={i === 0}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      onClick={() => {
                        const next = [...steps];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        setSteps(next);
                      }}
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Move down"
                      disabled={i === steps.length - 1}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      onClick={() => {
                        const next = [...steps];
                        [next[i + 1], next[i]] = [next[i], next[i + 1]];
                        setSteps(next);
                      }}
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Remove this step"
                      className="text-muted-foreground hover:text-danger"
                      onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              <Button
                size="sm"
                variant="ghost"
                className="w-fit"
                onClick={() => setSteps([...steps, { title: "" }])}
              >
                <Plus /> Add a step
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {steps === null ? (
              <Button size="sm" variant="outline" onClick={startEditing}>
                {draft ? "Edit draft" : approved ? "Revise" : "Write the procedure"}
              </Button>
            ) : (
              <>
                <Button size="sm" disabled={busy} onClick={save}>
                  {busy ? "Saving…" : draft ? "Save draft" : "Create draft"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSteps(null)}>
                  Cancel
                </Button>
              </>
            )}

            {draft && steps === null && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => approve.mutate({ versionId: draft.id })}
              >
                Approve v{draft.versionNumber}
              </Button>
            )}
          </div>

          <p className="max-w-prose text-2xs text-muted-foreground">
            A procedure is versioned, never edited in place: approving a new version supersedes the
            last rather than replacing it, and tasks already generated keep resolving to the version
            that applied to them. You cannot approve a workflow you wrote yourself — approval needs a
            second person, the same as everywhere else here.
          </p>
        </div>
      </td>
    </tr>
  );
}
