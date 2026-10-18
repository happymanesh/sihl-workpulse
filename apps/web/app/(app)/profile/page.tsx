"use client";

import { Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { trpc } from "@/lib/trpc/client";

/**
 * Who workPulse thinks you are, and why.
 *
 * Mostly read-only on purpose: identity comes from Synapse, the org from
 * Frappe HR, and workPulse owns only the join. Showing where each fact came
 * from is more useful than pretending any of it is editable here - when
 * somebody's department is wrong, the fix is in Frappe HR, and this page
 * should send them there rather than offering a field that silently does
 * nothing on the next sync.
 */
export default function ProfilePage() {
  const me = trpc.meta.me.useQuery();
  const deskCard = trpc.deskCard.mine.useQuery();

  const user = me.data;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 py-5">
          <div className="flex flex-col gap-0.5">
            <span className="text-lg font-semibold">{user?.fullName ?? "…"}</span>
            <span className="text-xs text-muted-foreground">{user?.username}</span>
          </div>

          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <Field label="Your roles">
              <div className="flex flex-wrap gap-1.5">
                {(user?.roles ?? []).map((r) => (
                  <Badge key={r} tone="info">
                    {r.replace(/_/g, " ").toLowerCase()}
                  </Badge>
                ))}
                {user && user.roles.length === 0 && <span className="text-xs">none</span>}
              </div>
            </Field>
            <Field label="Company">{user?.companyCode ?? "—"}</Field>
            <Field label="Hierarchy">{user?.hierarchyCode ?? "—"}</Field>
            <Field label="Desk cards">
              {(deskCard.data ?? []).length === 0
                ? "none held"
                : (deskCard.data ?? []).map((c) => c.name).join(", ")}
            </Field>
          </div>
        </CardContent>
      </Card>

      {user?.isEmployeeUnlinked && (
        <Card className="border-warning/40">
          <CardContent className="flex gap-3 py-4">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">No employee record is linked to your account</p>
              <p className="max-w-2xl text-2xs text-muted-foreground">
                workPulse matches your Synapse account to a Frappe HR employee by email address. No
                employee has yours, so you have no department, no desk card and no tasks — most
                screens will look empty. An administrator can correct the email in Frappe HR; it
                links on your next request, with nothing to re-do here.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex gap-3 py-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="max-w-2xl text-2xs text-muted-foreground">
            <span className="font-medium text-foreground">Why none of this is editable here.</span>{" "}
            Synapse owns who you are and what roles you hold; Frappe HR owns your department,
            manager and designation. workPulse keeps only the join between them, and re-reads both
            rather than storing its own copy — so a correction made at the source takes effect on
            your next request, and one made here would be overwritten by the next sync.
          </p>
        </CardContent>
      </Card>

      <Card id="preferences">
        <CardContent className="flex flex-col gap-3 py-4">
          <span className="label-caps">Settings</span>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Appearance</span>
            <ThemeToggle />
            <span className="text-2xs text-muted-foreground">
              Stored in this browser only — it does not follow you to another machine.
            </span>
          </div>
          <p className="text-2xs text-muted-foreground">
            workPulse is English-only for now. Dictation accepts any language you speak and saves
            the note in English, so a note is readable by whoever picks the work up.
          </p>
        </CardContent>
      </Card>

      <Card id="support">
        <CardContent className="flex flex-col gap-2 py-4">
          <span className="label-caps">Help and support</span>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Your department&apos;s workPulse helper is the first port of call — they are named before
            your team goes live. Anything they cannot answer goes to the Product &amp; AI Office.
          </p>
          <p className="max-w-2xl text-xs text-muted-foreground">
            If you think a figure about <span className="font-medium text-foreground">you</span> is
            wrong, raise it with HR or Audit directly rather than only with your manager. That route
            is deliberate.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-caps">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
