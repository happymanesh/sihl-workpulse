"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

/**
 * Administration of the middle of the governance chain:
 *
 *   Desk Card -> Activity -> Process -> Policy
 *
 * Until this screen existed the chain was enforced but unreachable - approving
 * an activity required a Process, and nothing could create one.
 */
export default function ControlsPage() {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const policies = trpc.governance.policies.useQuery();
  const processes = trpc.governance.processes.useQuery();
  const employees = trpc.employee.list.useQuery({ activeOnly: true });

  const refresh = () => {
    utils.governance.policies.invalidate();
    utils.governance.processes.invalidate();
  };
  const onError = (e: { message: string }) => setError(e.message);
  const onDone = () => {
    setError(null);
    refresh();
  };

  const createPolicy = trpc.governance.createPolicy.useMutation({ onSuccess: onDone, onError });
  const createProcess = trpc.governance.createProcess.useMutation({ onSuccess: onDone, onError });
  const setPolicyStatus = trpc.governance.setPolicyStatus.useMutation({ onSuccess: onDone, onError });
  const setProcessStatus = trpc.governance.setProcessStatus.useMutation({ onSuccess: onDone, onError });

  // Policy form
  const [pCode, setPCode] = useState("");
  const [pName, setPName] = useState("");
  const [pOwner, setPOwner] = useState("");
  const [pApprover, setPApprover] = useState("");

  // Process form
  const [prCode, setPrCode] = useState("");
  const [prName, setPrName] = useState("");
  const [prObjective, setPrObjective] = useState("");
  const [prOwner, setPrOwner] = useState("");
  const [prPolicy, setPrPolicy] = useState("");

  if (policies.error) {
    const code = policies.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "FORBIDDEN" ? "Not available to your role" : "Could not load controls"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN"
            ? "Policies and processes are managed by department heads and system administrators."
            : policies.error.message}
        </p>
      </Card>
    );
  }

  const staff = employees.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="flex gap-3 py-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-2xs text-muted-foreground">
            Work hangs off a named control:{" "}
            <span className="font-medium text-foreground">
              desk card → activity → process → policy
            </span>
            . An activity cannot be approved until it serves a process, so that nobody can answer
            &ldquo;why does this task exist?&rdquo; with a shrug. Create the policy first where there is
            one; a process may stand on its own.
          </p>
        </CardContent>
      </Card>

      {/* ---------------- Policies ---------------- */}
      <Card className="overflow-hidden">
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="label-caps">Policies</span>
        </div>

        <CardContent className="flex flex-wrap items-end gap-3 border-b border-border py-4">
          <Field label="Code" htmlFor="p-code" className="w-40">
            <Input id="p-code" value={pCode} placeholder="POL-AML" onChange={(e) => setPCode(e.target.value)} />
          </Field>
          <Field label="Name" htmlFor="p-name" className="min-w-56 flex-1">
            <Input id="p-name" value={pName} placeholder="Anti-money laundering" onChange={(e) => setPName(e.target.value)} />
          </Field>
          <Field label="Owner" htmlFor="p-owner" className="w-48">
            <Select id="p-owner" value={pOwner} onChange={(e) => setPOwner(e.target.value)}>
              <option value="">Choose…</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Approver" htmlFor="p-approver" className="w-48">
            <Select id="p-approver" value={pApprover} onChange={(e) => setPApprover(e.target.value)}>
              <option value="">Choose…</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </Field>
          <Button
            size="sm"
            disabled={!pCode || !pName || !pOwner || !pApprover || createPolicy.isPending}
            onClick={() => {
              createPolicy.mutate({
                code: pCode,
                name: pName,
                ownerEmployeeId: pOwner,
                approverEmployeeId: pApprover,
              });
              setPCode("");
              setPName("");
            }}
          >
            Add policy
          </Button>
          <p className="w-full text-2xs text-muted-foreground">
            Owner and approver must be different people — approving your own policy is not a control.
          </p>
        </CardContent>

        <div className="flex flex-col divide-y divide-border">
          {(policies.data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="w-32 text-xs font-medium tabular">{p.code}</span>
              <span className="min-w-48 flex-1 text-xs">{p.name}</span>
              <span className="text-2xs text-muted-foreground">
                {p.owner.name} → {p.approver.name}
              </span>
              <Badge tone={p.status === "APPROVED" ? "success" : p.status === "DRAFT" ? "neutral" : "warning"}>
                {p.status.toLowerCase()}
              </Badge>
              <span className="text-2xs text-muted-foreground">{p._count.processes} process(es)</span>
              {p.status === "DRAFT" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPolicyStatus.mutate({ policyId: p.id, status: "APPROVED" })}
                >
                  Approve
                </Button>
              )}
            </div>
          ))}
          {!policies.isLoading && (policies.data ?? []).length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No policies yet. A process can stand without one, but most should name the policy they serve.
            </div>
          )}
        </div>
      </Card>

      {/* ---------------- Processes ---------------- */}
      <Card className="overflow-hidden">
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="label-caps">Processes</span>
        </div>

        <CardContent className="flex flex-wrap items-end gap-3 border-b border-border py-4">
          <Field label="Code" htmlFor="pr-code" className="w-44">
            <Input id="pr-code" value={prCode} placeholder="PROC-KYC-REVIEW" onChange={(e) => setPrCode(e.target.value)} />
          </Field>
          <Field label="Name" htmlFor="pr-name" className="min-w-56 flex-1">
            <Input id="pr-name" value={prName} placeholder="Periodic KYC review" onChange={(e) => setPrName(e.target.value)} />
          </Field>
          <Field label="Owner" htmlFor="pr-owner" className="w-48">
            <Select id="pr-owner" value={prOwner} onChange={(e) => setPrOwner(e.target.value)}>
              <option value="">Choose…</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Serves policy" htmlFor="pr-policy" className="w-52">
            <Select id="pr-policy" value={prPolicy} onChange={(e) => setPrPolicy(e.target.value)}>
              <option value="">None</option>
              {(policies.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Control objective" htmlFor="pr-obj" className="w-full">
            <Textarea
              id="pr-obj"
              rows={2}
              value={prObjective}
              placeholder="What this control is for — what would go wrong without it."
              onChange={(e) => setPrObjective(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            disabled={!prCode || !prName || !prOwner || createProcess.isPending}
            onClick={() => {
              createProcess.mutate({
                code: prCode,
                name: prName,
                controlObjective: prObjective || undefined,
                ownerEmployeeId: prOwner,
                policyId: prPolicy || undefined,
              });
              setPrCode("");
              setPrName("");
              setPrObjective("");
            }}
          >
            Add process
          </Button>
        </CardContent>

        <div className="flex flex-col divide-y divide-border">
          {(processes.data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="w-44 text-xs font-medium tabular">{p.code}</span>
              <span className="min-w-48 flex-1 text-xs">{p.name}</span>
              <span className="text-2xs text-muted-foreground">{p.owner.name}</span>
              <span className="text-2xs text-muted-foreground">
                {p.policy ? p.policy.code : "no policy"}
              </span>
              <Badge tone={p.status === "APPROVED" ? "success" : p.status === "DRAFT" ? "neutral" : "warning"}>
                {p.status.toLowerCase()}
              </Badge>
              <span className="text-2xs text-muted-foreground">{p._count.activities} activity(ies)</span>
              {p.status === "DRAFT" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setProcessStatus.mutate({ processId: p.id, status: "APPROVED" })}
                >
                  Approve
                </Button>
              )}
            </div>
          ))}
          {!processes.isLoading && (processes.data ?? []).length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No processes yet. Activities cannot be approved until one exists for them to serve.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
