"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { trpc, type RouterOutputs } from "@/lib/trpc/client";

type Kind = "designation" | "branch";
type Row = RouterOutputs["orgMaster"]["list"][number];

const LABEL: Record<Kind, { one: string; many: string; blurb: string }> = {
  designation: {
    one: "designation",
    many: "Designations",
    blurb:
      "Job titles as HR sends them. The feed spells the same job several ways, so new rows arrive unreviewed — confirm the ones that are right, merge the ones that are the same job twice.",
  },
  branch: {
    one: "branch",
    many: "Branches",
    blurb: "Offices as HR sends them, on the same terms.",
  },
};

/**
 * The governed org lists.
 *
 * Renaming a row changes it everywhere at once, because employees point at the
 * row and not at the text. Merging moves people rather than stranding them.
 * Neither is a delete: a record from two years ago should still resolve.
 */
export default function OrgMastersPage() {
  const [kind, setKind] = useState<Kind>("designation");
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const rows = trpc.orgMaster.list.useQuery({ kind });
  const refresh = () => utils.orgMaster.list.invalidate();
  const onError = (e: { message: string }) => setError(e.message);
  const onDone = () => {
    setError(null);
    refresh();
  };

  const markReviewed = trpc.orgMaster.markReviewed.useMutation({ onSuccess: onDone, onError });
  const setActive = trpc.orgMaster.setActive.useMutation({ onSuccess: onDone, onError });

  if (rows.error) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm font-medium">Not available to your role</p>
          <p className="mt-1 text-xs text-muted-foreground">{rows.error.message}</p>
        </CardContent>
      </Card>
    );
  }

  const list = rows.data ?? [];
  const unreviewed = list.filter((r) => !r.reviewed).length;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col gap-2 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-caps">{LABEL[kind].many}</span>
            <Select
              aria-label="Which list"
              className="ml-auto w-44"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              <option value="designation">Designations</option>
              <option value="branch">Branches</option>
            </Select>
          </div>
          <p className="max-w-3xl text-xs text-muted-foreground">{LABEL[kind].blurb}</p>
          {unreviewed > 0 && (
            <p className="text-2xs text-warning">
              {unreviewed} {unreviewed === 1 ? "row has" : "rows have"} not been looked at yet.
            </p>
          )}
        </CardContent>
      </Card>

      {list.map((row) => (
        <MasterRow
          key={row.id}
          kind={kind}
          row={row}
          all={list}
          onError={onError}
          onDone={onDone}
          onReview={() => markReviewed.mutate({ kind, id: row.id })}
          onRetire={() => setActive.mutate({ kind, id: row.id, isActive: !row.isActive })}
        />
      ))}

      {list.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing here yet. Rows appear the first time the HR sync sees a value — run
          “Update from Synapse” on the Employees screen if you expected some.
        </p>
      )}
    </div>
  );
}

function MasterRow({
  kind,
  row,
  all,
  onError,
  onDone,
  onReview,
  onRetire,
}: {
  kind: Kind;
  row: Row;
  all: Row[];
  onError: (e: { message: string }) => void;
  onDone: () => void;
  onReview: () => void;
  onRetire: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(row.name);
  const [mergeInto, setMergeInto] = useState("");

  const rename = trpc.orgMaster.rename.useMutation({
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
    onError,
  });
  const merge = trpc.orgMaster.merge.useMutation({
    onSuccess: () => {
      setOpen(false);
      setMergeInto("");
      onDone();
    },
    onError,
  });

  const others = all.filter((r) => r.id !== row.id && r.isActive);

  return (
    <Card className={row.isActive ? undefined : "opacity-70"}>
      <CardContent className="flex flex-col gap-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.name}</span>
          {!row.reviewed && <Badge tone="warning">not reviewed</Badge>}
          {!row.isActive && <Badge tone="neutral">retired</Badge>}
          <span className="ml-auto text-2xs text-muted-foreground">
            {row._count.employees} {row._count.employees === 1 ? "person" : "people"}
          </span>
          {!row.reviewed && (
            <button
              type="button"
              className="text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={onReview}
            >
              Looks right
            </button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Edit"}
          </Button>
        </div>

        {open && (
          <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1">
              <span className="label-caps">Rename</span>
              <div className="flex gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
                <Button
                  size="sm"
                  disabled={name.trim() === row.name || name.trim().length < 2 || rename.isPending}
                  onClick={() => rename.mutate({ kind, id: row.id, name: name.trim() })}
                >
                  Save
                </Button>
              </div>
              <span className="text-2xs text-muted-foreground">
                Changes it everywhere at once — nobody&apos;s record is touched.
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-1">
              <span className="label-caps">Merge into</span>
              <div className="flex gap-2">
                <Select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                  <option value="">Choose the one to keep…</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!mergeInto || merge.isPending}
                  onClick={() => merge.mutate({ kind, fromId: row.id, intoId: mergeInto })}
                >
                  Merge
                </Button>
              </div>
              <span className="text-2xs text-muted-foreground">
                Moves {row._count.employees} {row._count.employees === 1 ? "person" : "people"}, then
                retires this one.
              </span>
            </div>

            <button
              type="button"
              className="text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline sm:pb-2"
              onClick={onRetire}
            >
              {row.isActive ? "Retire" : "Bring back"}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
