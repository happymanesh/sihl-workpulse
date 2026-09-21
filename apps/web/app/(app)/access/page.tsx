"use client";

import { useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const WORKPULSE_ROLES = [
  "EMPLOYEE",
  "MANAGER",
  "DEPARTMENT_HEAD",
  "PROJECT_MANAGER",
  "EXECUTIVE",
  "EXECUTIVE_RESTRICTED",
  "AUDIT",
  "INTEGRATION_SERVICE",
  "SYSTEM_ADMIN",
] as const;

type Role = (typeof WORKPULSE_ROLES)[number];

/** Roles that carry access to people's performance or confidential work. */
const SENSITIVE: Role[] = ["AUDIT", "EXECUTIVE_RESTRICTED", "EXECUTIVE", "INTEGRATION_SERVICE"];

export default function AccessPage() {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState("");
  const [grantRole, setGrantRole] = useState<Role>("DEPARTMENT_HEAD");
  const [reason, setReason] = useState("");

  const coverage = trpc.access.coverage.useQuery();
  const mappings = trpc.access.mappings.useQuery();
  const holders = trpc.access.holders.useQuery();

  const invalidate = () => {
    utils.access.coverage.invalidate();
    utils.access.holders.invalidate();
    utils.access.mappings.invalidate();
  };

  const grant = trpc.access.grant.useMutation({
    onSuccess: () => {
      setError(null);
      setReason("");
      setUid("");
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const revoke = trpc.access.revoke.useMutation({
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (coverage.error) {
    const code = coverage.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "UNAUTHORIZED"
            ? "Sign in to continue"
            : code === "FORBIDDEN"
              ? "Not available to your role"
              : "Could not load access control"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN"
            ? "Access control is available to system administrators and Audit."
            : coverage.error.message}
        </p>
      </Card>
    );
  }

  const rows = coverage.data ?? [];
  const unreachable = rows.filter((r) => r.isUnreachable);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {/* The report that turned a silent gap into a known one. */}
      {unreachable.length > 0 && (
        <Card className="border-warning/40">
          <CardContent className="flex gap-3 py-4">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">
                {unreachable.length} role{unreachable.length === 1 ? "" : "s"} nobody can reach
              </p>
              <p className="max-w-2xl text-2xs text-muted-foreground">
                No Synapse role maps to these and nobody holds them directly, so the controls behind
                them cannot be exercised by anyone. Identity resolution is deny-by-default with no
                fallback role, so this fails closed rather than over-granting — but it has to be
                fixed before go-live rather than discovered during it.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="label-caps">Role coverage</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="label-caps px-4 py-2.5">workPulse role</th>
                <th className="label-caps px-4 py-2.5">Reached via Synapse</th>
                <th className="label-caps px-4 py-2.5">Direct grants</th>
                <th className="label-caps px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.role} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 text-xs font-medium tabular">{r.role}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {r.synapseRoles.length > 0 ? r.synapseRoles.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {r.hasLocalGrant ? "yes" : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.isUnreachable ? (
                      <Badge tone="warning">unreachable</Badge>
                    ) : (
                      <Badge tone="success">reachable</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Grant */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <span className="label-caps">Grant a role directly</span>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Synapse user id" htmlFor="uid" className="w-36">
              <Input
                id="uid"
                type="number"
                min={1}
                value={uid}
                placeholder="e.g. 2"
                onChange={(e) => setUid(e.target.value)}
              />
            </Field>
            <Field label="Role" htmlFor="role" className="w-56">
              <Select id="role" value={grantRole} onChange={(e) => setGrantRole(e.target.value as Role)}>
                {WORKPULSE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason" htmlFor="reason" className="min-w-64 flex-1">
              <Input
                id="reason"
                value={reason}
                placeholder={
                  SENSITIVE.includes(grantRole) ? "Required for this role" : "Optional"
                }
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              disabled={!uid || grant.isPending}
              onClick={() =>
                grant.mutate({
                  synapseUserUid: Number(uid),
                  role: grantRole,
                  reason: reason || undefined,
                })
              }
            >
              Grant
            </Button>
          </div>

          {SENSITIVE.includes(grantRole) && (
            <p className="text-2xs text-warning">
              {grantRole} reads people&apos;s performance or confidential work. A written reason is
              required, the grant is audited, and you cannot grant AUDIT or EXECUTIVE_RESTRICTED to
              yourself — those need a second administrator&apos;s name against them.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Holders */}
      <Card className="overflow-hidden">
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="label-caps">Directly granted roles</span>
        </div>
        <div className="flex flex-col divide-y divide-border">
          {(holders.data ?? []).map((h) => (
            <div key={h.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {h.employee?.name ?? h.synapseUsername}
                </span>
                <span className="text-2xs tabular text-muted-foreground">
                  uid {h.synapseUserUid}
                </span>
                {h.isEmployeeUnlinked && <Badge tone="warning">no employee record</Badge>}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {h.localRoles.map((r) => (
                  <span key={r} className="flex items-center gap-1">
                    <Badge tone={SENSITIVE.includes(r as Role) ? "danger" : "neutral"}>{r}</Badge>
                    <button
                      type="button"
                      className="text-2xs text-muted-foreground underline-offset-2 hover:underline"
                      disabled={revoke.isPending}
                      onClick={() =>
                        revoke.mutate({
                          synapseUserUid: h.synapseUserUid,
                          role: r,
                          reason: "Revoked from the access screen",
                        })
                      }
                    >
                      revoke
                    </button>
                  </span>
                ))}
              </div>

              {h.grantHistory.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {h.grantHistory.slice(0, 3).map((g, i) => (
                    <li key={`${g.createdAt}-${i}`} className="text-2xs text-muted-foreground">
                      {g.action === "GRANT_ROLE" ? "Granted" : "Revoked"}{" "}
                      {new Date(g.createdAt).toLocaleDateString()}
                      {g.reason ? ` — ${g.reason}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {!holders.isLoading && (holders.data ?? []).length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              Nobody holds a directly granted role.
            </div>
          )}
        </div>
      </Card>

      {/* Mappings */}
      <Card className="overflow-hidden">
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="label-caps">Synapse roles</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="label-caps px-4 py-2.5">Synapse role</th>
                <th className="label-caps px-4 py-2.5">Name</th>
                <th className="label-caps px-4 py-2.5">Maps to</th>
              </tr>
            </thead>
            <tbody>
              {(mappings.data?.synapseRoles ?? []).map((r) => {
                const mapped = mappings.data?.mappings.find(
                  (m) => m.synapseRoleCode === r.roleCode && m.isActive,
                );
                return (
                  <tr key={r.roleCode} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 text-xs font-medium tabular">{r.roleCode}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.roleName}</td>
                    <td className="px-4 py-2.5">
                      {mapped ? (
                        <span className="text-xs tabular">{mapped.workPulseRole}</span>
                      ) : r.isMappable ? (
                        <span className="text-2xs text-muted-foreground">not mapped</span>
                      ) : (
                        <Badge tone="danger" title="Held by external clients — mapping it would give customers workPulse accounts.">
                          never mappable
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(mappings.data?.synapseRoles ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    {mappings.data?.directoryReachable === false
                      ? "Could not reach the Synapse directory."
                      : "No active Synapse roles returned."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardContent className="flex gap-3 py-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className={cn("flex flex-col gap-1.5 text-2xs text-muted-foreground")}>
            <p>
              <span className="font-medium text-foreground">
                Synapse has five roles, and six workPulse roles have no counterpart in it.
              </span>{" "}
              They cannot be fixed by adding mapping rows, because there is nothing to map from.
              Pointing one at an existing operational role — SUPPORT_LEAD to EXECUTIVE, say — would
              hand confidential-task visibility to whoever runs the support desk. Direct grants are
              the mechanism for these, and every one is audited.
            </p>
            <p>
              The durable fix is for SIHL to create the corresponding roles in Synapse and map them
              here. Until then, a direct grant is a named decision with a reason attached, which is
              the right shape for a role like AUDIT anyway.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
