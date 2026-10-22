import { prisma } from "@workpulse/db";
import type { FrappeHrSyncResult } from "@workpulse/shared-types";
import { createFrappeHrClient, hrSource, type FrappeHrClient } from "./frappe-hr-client";

/**
 * Runs one HR -> workPulse sync pass. The source is chosen by HR_SOURCE (default
 * synapse; see createFrappeHrClient) - the job name keeps "frappe" for history. Idempotent and safe to run on
 * a schedule (default: every 2 hours, see FRAPPE_SYNC_CRON in .env.example)
 * or manually via `npm run sync:frappe-hr`.
 *
 * Departments are synced before Employees so employee.departmentId foreign
 * keys always resolve. Manager linkage is applied in a second pass over
 * Employees, since a manager may appear later in the source list than their
 * report.
 */
/**
 * Fold a free-text value onto its governed row, creating one the first time a
 * spelling is seen.
 *
 * Matching is on the normalised form - lower-cased, whitespace collapsed - so
 * "Executive", "EXECUTIVE" and "Executive  " are one row rather than three.
 * The first spelling seen becomes the display name; an administrator renames
 * it afterwards without touching a single employee record, because everybody
 * points at the row rather than at the text.
 *
 * New rows arrive unreviewed. That is deliberate: it is the queue a person
 * works through, not a list the sync is entitled to call finished.
 */
async function resolveMaster(
  table: "designation" | "branch",
  raw: string | null | undefined,
): Promise<string | null> {
  const name = raw?.trim().replace(/\s+/g, " ");
  if (!name) return null;

  const normalised = name.toLowerCase();

  // Written out per table rather than picking the delegate dynamically:
  // Prisma's two delegates do not unify into one callable type.
  if (table === "designation") {
    const found = await prisma.designation.findUnique({ where: { normalised } });
    if (found) return found.id;
    const made = await prisma.designation.create({ data: { name, normalised } });
    return made.id;
  }

  const found = await prisma.branch.findUnique({ where: { normalised } });
  if (found) return found.id;
  const made = await prisma.branch.create({ data: { name, normalised } });
  return made.id;
}

export async function runFrappeHrSync(client: FrappeHrClient = createFrappeHrClient()): Promise<FrappeHrSyncResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let employeesSynced = 0;
  let departmentsSynced = 0;

  try {
    const rawDepartments = await client.fetchDepartments();
    for (const dept of rawDepartments) {
      await prisma.department.upsert({
        where: { frappeDepartmentId: dept.departmentId },
        create: {
          frappeDepartmentId: dept.departmentId,
          name: dept.name,
        },
        update: {
          name: dept.name,
          lastSyncedAt: new Date(),
        },
      });
      departmentsSynced++;
    }

    // Second pass: resolve parentDepartmentId now that all departments exist.
    for (const dept of rawDepartments) {
      if (!dept.parentDepartmentId) continue;
      const parent = await prisma.department.findUnique({
        where: { frappeDepartmentId: dept.parentDepartmentId },
      });
      if (parent) {
        await prisma.department.update({
          where: { frappeDepartmentId: dept.departmentId },
          data: { parentDepartmentId: parent.id },
        });
      }
    }
  } catch (err) {
    errors.push(`Department sync failed: ${(err as Error).message}`);
  }

  try {
    const rawEmployees = await client.fetchEmployees();
    for (const emp of rawEmployees) {
      const department = emp.departmentId
        ? await prisma.department.findUnique({ where: { frappeDepartmentId: emp.departmentId } })
        : null;

      const designationId = await resolveMaster("designation", emp.designation);
      const branchId = await resolveMaster("branch", emp.branch);

      await prisma.employee.upsert({
        where: { employeeCode: emp.employeeId },
        create: {
          employeeCode: emp.employeeId,
          name: emp.fullName,
          email: emp.email,
          designation: emp.designation,
          branch: emp.branch ?? null,
          designationId,
          branchId,
          isActive: emp.isActive,
          departmentId: department?.id,
        },
        update: {
          name: emp.fullName,
          email: emp.email,
          designation: emp.designation,
          branch: emp.branch ?? null,
          designationId,
          branchId,
          isActive: emp.isActive,
          departmentId: department?.id,
          lastSyncedAt: new Date(),
        },
      });
      employeesSynced++;
    }

    // Second pass: resolve managerId now that all employees exist.
    for (const emp of rawEmployees) {
      if (!emp.managerEmployeeId) continue;
      const manager = await prisma.employee.findUnique({
        where: { employeeCode: emp.managerEmployeeId },
      });
      if (manager) {
        await prisma.employee.update({
          where: { employeeCode: emp.employeeId },
          data: { managerId: manager.id },
        });
      }
    }
  } catch (err) {
    errors.push(`Employee sync failed: ${(err as Error).message}`);
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: hrSource() === "synapse" ? "synapse" : ((process.env.FRAPPE_SYNC_MODE as "mock" | "live") ?? "mock"),
    employeesSynced,
    departmentsSynced,
    errors,
  };
}
