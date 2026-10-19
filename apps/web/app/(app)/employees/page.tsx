"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

/**
 * The employee read-cache.
 *
 * Read-only on purpose, and the page says why: Frappe HR owns this data and a
 * sync job is the only thing that writes it. A field edited here would be
 * overwritten on the next run, so offering the edit would be a lie — the
 * honest screen shows the data and names where to go to change it.
 *
 * The menu has linked here since the first release and the route never
 * existed, so this was a 404 in the sidebar.
 */
export default function EmployeesPage() {
  const employees = trpc.employee.list.useQuery({ activeOnly: false });
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [active, setActive] = useState("active");

  // Memoised so the department list below has a stable dependency: `?? []`
  // produces a new array on every render, which would rebuild the list each time.
  const rows = useMemo(() => employees.data ?? [], [employees.data]);

  const departments = useMemo(
    () => [...new Set(rows.map((e) => e.departmentName).filter(Boolean))].sort() as string[],
    [rows],
  );

  const filtered = rows.filter((e) => {
    if (active === "active" && !e.isActive) return false;
    if (active === "inactive" && e.isActive) return false;
    if (department && e.departmentName !== department) return false;
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (
      e.name.toLowerCase().includes(needle) ||
      e.employeeCode.toLowerCase().includes(needle) ||
      (e.designation ?? "").toLowerCase().includes(needle)
    );
  });

  if (employees.error) {
    const code = employees.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "FORBIDDEN" ? "Not available to your role" : "Could not load employees"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN"
            ? "The employee directory is available to managers, department heads and administrators."
            : employees.error.message}
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={q}
          placeholder="Name, code or designation…"
          className="min-w-56 flex-1"
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          value={department}
          className="w-56"
          onChange={(e) => setDepartment(e.target.value)}
          aria-label="Department"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Select
          value={active}
          className="w-36"
          onChange={(e) => setActive(e.target.value)}
          aria-label="Status"
        >
          <option value="active">Active</option>
          <option value="inactive">Leavers</option>
          <option value="all">Everyone</option>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground tabular">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="label-caps px-4 py-2.5">Name</th>
                <th className="label-caps px-4 py-2.5">Code</th>
                <th className="label-caps px-4 py-2.5">Designation</th>
                <th className="label-caps px-4 py-2.5">Department</th>
                <th className="label-caps px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm">{e.name}</span>
                      {e.email && <span className="text-2xs text-muted-foreground">{e.email}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-2xs text-muted-foreground">
                    {e.employeeCode}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {e.designation ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {e.departmentName ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {e.isActive ? (
                      <Badge tone="success">active</Badge>
                    ) : (
                      <Badge tone="neutral">left</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {!employees.isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    Nobody matches that.
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
          <p className="max-w-2xl text-2xs text-muted-foreground">
            <span className="font-medium text-foreground">Read-only, deliberately.</span> Frappe HR
            owns this data and the sync job is the only thing that writes it — anything changed here
            would be overwritten on the next run. If somebody&apos;s department, designation or
            manager is wrong, correct it in Frappe HR and it arrives on the next sync. Leavers are
            kept rather than deleted: work they did, and the handover record, both point at them.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
