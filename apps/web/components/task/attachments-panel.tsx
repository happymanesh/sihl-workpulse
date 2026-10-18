"use client";

import { useRef, useState } from "react";
import { Download, Paperclip, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

/** Mirrors ALLOWED_TYPES on the API. The server decides; this only filters the picker. */
const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.msg,.eml";
const MAX_MB = 25;

/** Statuses after which nothing may be taken off the task — matches the API. */
const SETTLED = ["VERIFIED", "CLOSED"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files on a task.
 *
 * Evidence, not decoration: a file attached here is one of the three things the
 * closure check looks for, alongside a completed checklist item and a
 * completion note. So the panel says what counts, shows withdrawn files rather
 * than hiding them, and asks for a reason before withdrawing one.
 */
export function AttachmentsPanel({ taskId, taskStatus }: { taskId: string; taskStatus: string }) {
  const utils = trpc.useUtils();
  const list = trpc.task.attachments.useQuery({ taskId });
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"EVIDENCE" | "REFERENCE">("EVIDENCE");
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const settled = SETTLED.includes(taskStatus);

  const remove = trpc.task.removeAttachment.useMutation({
    onSuccess: () => {
      setWithdrawing(null);
      setReason("");
      utils.task.attachments.invalidate({ taskId });
    },
    onError: (e) => setError(e.message),
  });

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is ${formatBytes(file.size)}. The limit is ${MAX_MB} MB.`);
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/backend/attachments/${taskId}?kind=${kind}`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        // The API's refusals are written to be read by the person who hit them,
        // so show what it said rather than a generic failure.
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.message ?? `Upload failed (${res.status})`);
      }
      await utils.task.attachments.invalidate({ taskId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const files = list.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Files</CardTitle>
        <Badge tone="neutral">{files.filter((f) => !f.removedAt).length}</Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        {files.map((f) => (
          <div
            key={f.id}
            className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {f.removedAt ? (
                <span className="text-sm text-muted-foreground line-through">{f.fileName}</span>
              ) : (
                <a
                  href={`/api/backend/attachments/${f.id}/download`}
                  className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  {f.fileName}
                  <Download className="size-3" aria-hidden />
                </a>
              )}
              <Badge tone={f.kind === "EVIDENCE" ? "info" : "neutral"}>{f.kind.toLowerCase()}</Badge>
              {f.removedAt && <Badge tone="warning">withdrawn</Badge>}
              <span className="ml-auto text-2xs text-muted-foreground tabular">
                {formatBytes(f.sizeBytes)} · {new Date(f.createdAt).toLocaleString()}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-2 pl-5">
              <span className="text-2xs text-muted-foreground">
                {f.uploadedBy.name}
                {f.uploadedBy.designation ? ` · ${f.uploadedBy.designation}` : ""}
              </span>
              {!f.removedAt && !settled && (
                <button
                  type="button"
                  className="text-2xs text-muted-foreground underline-offset-2 hover:text-danger hover:underline"
                  onClick={() => {
                    setWithdrawing(withdrawing === f.id ? null : f.id);
                    setReason("");
                  }}
                >
                  {withdrawing === f.id ? "Cancel" : "Withdraw"}
                </button>
              )}
              {f.removedAt && f.removalReason && (
                <span className="text-2xs text-muted-foreground">
                  Withdrawn {new Date(f.removedAt).toLocaleDateString()} — {f.removalReason}
                </span>
              )}
            </div>

            {withdrawing === f.id && (
              <div className="flex flex-wrap items-end gap-2 pl-5 pt-1">
                <Input
                  value={reason}
                  placeholder="Why this file is coming off"
                  className="h-8 min-w-64 flex-1"
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reason.trim().length < 3 || remove.isPending}
                  onClick={() => remove.mutate({ attachmentId: f.id, reason: reason.trim() })}
                >
                  Withdraw
                </Button>
              </div>
            )}
          </div>
        ))}

        {!list.isLoading && files.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing attached yet. A file attached here counts as evidence that the work was done —
            so does a completed checklist item or a completion note.
          </p>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
              <Upload /> {busy ? "Uploading…" : "Attach a file"}
            </Button>
            <div className="flex items-center gap-1 text-2xs text-muted-foreground">
              <label htmlFor="att-kind">as</label>
              <select
                id="att-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                className="h-7 rounded-md border border-input bg-card px-1.5 text-xs"
              >
                <option value="EVIDENCE">Evidence</option>
                <option value="REFERENCE">Reference</option>
              </select>
            </div>
          </div>

          <p className="text-2xs text-muted-foreground">
            Up to {MAX_MB} MB. Documents, spreadsheets, images and saved email — no archives, since a
            zip proves nothing until somebody opens it.{" "}
            {settled
              ? "This task is verified or closed, so nothing can be taken off it — attach a correction instead."
              : "A file can be withdrawn with a reason until the task is verified; the record keeps that it was here."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
