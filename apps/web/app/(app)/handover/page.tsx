"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Info, Lock, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

type Reason = "EXIT" | "INTERNAL_TRANSFER" | "ROLE_CHANGE";

const REASONS: { value: Reason; label: string; blurb: string }[] = [
  { value: "EXIT", label: "Leaving SIHL", blurb: "Everything they hold has to go to somebody else." },
  {
    value: "INTERNAL_TRANSFER",
    label: "Moving department",
    blurb: "Departmental duties hand over. Work that is genuinely theirs travels with them.",
  },
  { value: "ROLE_CHANGE", label: "Changing seat", blurb: "The desk card moves. Little else does." },
];

export default function HandoverPage() {
  const utils = trpc.useUtils();
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState<Reason>("INTERNAL_TRANSFER");
  const [toDepartmentId, setToDepartmentId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const employees = trpc.employee.list.useQuery({ activeOnly: true });
  const departments = trpc.reference.departments.useQuery();
  const handover = trpc.handover.get.useQuery({ employeeId }, { enabled: Boolean(employeeId) });

  const refresh = () => utils.handover.get.invalidate();
  const onError = (e: { message: string }) => setError(e.message);

  const build = trpc.handover.build.useMutation({ onSuccess: () => { setError(null); refresh(); }, onError });
  const transferItem = trpc.handover.transferItem.useMutation({ onSuccess: () => { setError(null); refresh(); }, onError });
  const setDisposition = trpc.handover.setDisposition.useMutation({ onSuccess: () => { setError(null); refresh(); }, onError });
  const approve = trpc.handover.approve.useMutation({ onSuccess: () => { setError(null); refresh(); }, onError });
  const complete = trpc.handover.complete.useMutation({
    onSuccess: () => { setError(null); setOverrideReason(""); refresh(); },
    onError,
  });

  const h = handover.data;
  const items = useMemo(() => h?.items ?? [], [h]);
  const blocking = items.filter((i) => i.isBlocking && !i.transferredAt && !i.waivedReason);
  const toHandOver = items.filter((i) => i.disposition === "HAND_OVER" && !i.isBlocking);
  const retained = items.filter((i) => i.disposition === "RETAINED");
  const isTransfer = h?.reason === "INTERNAL_TRANSFER";

  if (handover.error) {
    const code = handover.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "FORBIDDEN" ? "Not available to your role" : "Could not load the handover"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN"
            ? "Handovers are managed by HR, managers and department heads."
            : handover.error.message}
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {/* Start / select */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Employee" htmlFor="emp" className="min-w-56 flex-1">
              <Select id="emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Choose someone…</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.departmentName ? ` — ${e.departmentName}` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            {employeeId && !h && (
              <>
                <Field label="Reason" htmlFor="reason" className="w-52">
                  <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
                    {REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                {reason === "INTERNAL_TRANSFER" && (
                  <Field label="Moving to" htmlFor="dept" className="w-52">
                    <Select id="dept" value={toDepartmentId} onChange={(e) => setToDepartmentId(e.target.value)}>
                      <option value="">Choose department…</option>
                      {(departments.data ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                <Field label="Effective date" htmlFor="eff" className="w-44">
                  <Input id="eff" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
                </Field>

                <Button
                  size="sm"
                  disabled={build.isPending || (reason === "INTERNAL_TRANSFER" && !toDepartmentId)}
                  onClick={() =>
                    build.mutate({
                      employeeId,
                      reason,
                      toDepartmentId: reason === "INTERNAL_TRANSFER" ? toDepartmentId : undefined,
                      effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
                    })
                  }
                >
                  Build the list
                </Button>
              </>
            )}
          </div>

          {employeeId && !h && (
            <p className="text-2xs text-muted-foreground">{REASONS.find((r) => r.value === reason)?.blurb}</p>
          )}
        </CardContent>
      </Card>

      {employeeId && !h && !handover.isLoading && (
        <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium">No open handover for this person</p>
          <p className="max-w-lg text-xs text-muted-foreground">
            Choose why their work is moving and build the list. It is generated from live data, so anything they
            picked up this week is included.
          </p>
        </Card>
      )}

      {h && (
        <>
          {/* Summary */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
              <div className="flex flex-col gap-0.5">
                <span className="label-caps">Employee</span>
                <span className="text-sm font-medium">{h.employee.name}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="label-caps">From</span>
                  <span className="text-sm">{h.employee.department?.name ?? "—"}</span>
                </div>
                {h.toDepartment && (
                  <>
                    <ArrowRight className="mt-3 size-3.5 text-muted-foreground" aria-hidden />
                    <div className="flex flex-col gap-0.5">
                      <span className="label-caps">To</span>
                      <span className="text-sm font-medium">{h.toDepartment.name}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="label-caps">Reason</span>
                <span className="text-sm">{REASONS.find((r) => r.value === h.reason)?.label ?? h.reason}</span>
              </div>
              {h.effectiveDate && (
                <div className="flex flex-col gap-0.5">
                  <span className="label-caps">Effective</span>
                  <span className="text-sm tabular">{new Date(h.effectiveDate).toLocaleDateString()}</span>
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                {blocking.length > 0 ? (
                  <Badge tone="warning">{blocking.length} still to hand over</Badge>
                ) : (
                  <Badge tone="success">nothing blocking</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Dual sign-off — transfers only */}
          {isTransfer && (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4 py-4">
                <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="flex min-w-48 flex-col gap-0.5">
                  <span className="text-xs font-medium">Both managers must sign</span>
                  <span className="text-2xs text-muted-foreground">
                    One signature is how somebody moves with their old obligations still attached.
                  </span>
                </div>
                <SignOff
                  label="Releasing manager"
                  signedAt={h.releasingApprovedAt}
                  pending={approve.isPending}
                  onSign={() => approve.mutate({ employeeId, side: "RELEASING" })}
                />
                <SignOff
                  label="Receiving manager"
                  signedAt={h.receivingApprovedAt}
                  pending={approve.isPending}
                  onSign={() => approve.mutate({ employeeId, side: "RECEIVING" })}
                />
              </CardContent>
            </Card>
          )}

          <ItemGroup
            title="Must be handed over before this completes"
            tone="warning"
            items={blocking}
            employees={employees.data ?? []}
            allowRetain={h.reason !== "EXIT"}
            onTransfer={(itemId, toEmployeeId) => transferItem.mutate({ itemId, toEmployeeId })}
            onRetain={(itemId) => setDisposition.mutate({ itemId, disposition: "RETAINED" })}
            empty="Nothing is blocking."
          />

          <ItemGroup
            title="To hand over"
            tone="neutral"
            items={toHandOver}
            employees={employees.data ?? []}
            allowRetain={h.reason !== "EXIT"}
            onTransfer={(itemId, toEmployeeId) => transferItem.mutate({ itemId, toEmployeeId })}
            onRetain={(itemId) => setDisposition.mutate({ itemId, disposition: "RETAINED" })}
            empty="Nothing else to pass on."
          />

          {h.reason !== "EXIT" && (
            <ItemGroup
              title="Staying with them"
              tone="success"
              items={retained}
              employees={employees.data ?? []}
              allowRetain={false}
              onHandOver={(itemId) => setDisposition.mutate({ itemId, disposition: "HAND_OVER" })}
              empty="Nothing is travelling with them."
            />
          )}

          {/* Complete */}
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 py-4">
              {blocking.length > 0 && (
                <Field label="Override reason" htmlFor="ovr" className="min-w-72 flex-1">
                  <Input
                    id="ovr"
                    value={overrideReason}
                    placeholder="Required to complete with items outstanding"
                    onChange={(e) => setOverrideReason(e.target.value)}
                  />
                </Field>
              )}
              <Button
                size="sm"
                disabled={complete.isPending || (blocking.length > 0 && !overrideReason.trim())}
                onClick={() => complete.mutate({ employeeId, overrideReason: overrideReason || undefined })}
              >
                {blocking.length > 0 ? "Complete with override" : "Complete handover"}
              </Button>
              {blocking.length > 0 && (
                <p className="flex items-center gap-1.5 text-2xs text-warning">
                  <TriangleAlert className="size-3.5" aria-hidden />
                  Overriding needs a System Admin, and is recorded against your name.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex gap-3 py-4">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-2xs text-muted-foreground">
                Handing work over does not erase who did it. Each transfer records the original owner, so the
                history still shows the task was theirs and for how long. Completing a move also updates the
                employee&apos;s department here — Frappe HR remains the master and will reassert it on the next sync.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SignOff({
  label,
  signedAt,
  pending,
  onSign,
}: {
  label: string;
  signedAt: Date | null;
  pending: boolean;
  onSign: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-caps">{label}</span>
      {signedAt ? (
        <Badge tone="success">signed {new Date(signedAt).toLocaleDateString()}</Badge>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={onSign}>
          Sign
        </Button>
      )}
    </div>
  );
}

interface ItemRow {
  id: string;
  itemType: string;
  description: string;
  isBlocking: boolean;
  disposition: string;
  transferredAt: Date | null;
  transferredToEmployeeId: string | null;
  waivedReason: string | null;
}

function ItemGroup({
  title,
  tone,
  items,
  employees,
  allowRetain,
  onTransfer,
  onRetain,
  onHandOver,
  empty,
}: {
  title: string;
  tone: "warning" | "neutral" | "success";
  items: ItemRow[];
  employees: { id: string; name: string }[];
  allowRetain: boolean;
  onTransfer?: (itemId: string, toEmployeeId: string) => void;
  onRetain?: (itemId: string) => void;
  onHandOver?: (itemId: string) => void;
  empty: string;
}) {
  const [target, setTarget] = useState<Record<string, string>>({});

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <span className="label-caps">{title}</span>
        <Badge tone={tone}>{items.length}</Badge>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {items.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="flex min-w-64 flex-1 flex-col gap-0.5">
              <span className="text-xs font-medium">{i.description}</span>
              <span className="text-2xs text-muted-foreground">
                {i.itemType.replace(/_/g, " ").toLowerCase()}
                {i.transferredAt ? " · handed over" : ""}
                {i.waivedReason ? ` · waived: ${i.waivedReason}` : ""}
              </span>
            </div>

            {!i.transferredAt && !i.waivedReason && onTransfer && (
              <div className="flex items-center gap-2">
                <Select
                  aria-label={`Hand ${i.description} to`}
                  className="h-7 w-48 text-xs"
                  value={target[i.id] ?? ""}
                  onChange={(e) => setTarget((t) => ({ ...t, [i.id]: e.target.value }))}
                >
                  <option value="">Hand over to…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!target[i.id]}
                  onClick={() => onTransfer(i.id, target[i.id])}
                >
                  Hand over
                </Button>
                {allowRetain && onRetain && (
                  <Button size="sm" variant="ghost" onClick={() => onRetain(i.id)}>
                    They keep it
                  </Button>
                )}
              </div>
            )}

            {onHandOver && !i.transferredAt && (
              <Button size="sm" variant="ghost" onClick={() => onHandOver(i.id)}>
                Hand it over instead
              </Button>
            )}
          </div>
        ))}

        {items.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">{empty}</div>
        )}
      </div>
    </Card>
  );
}
