import { prisma } from "@workpulse/db";
import type { FrappeHrSyncResult } from "@workpulse/shared-types";
import { createFrappeHrClient, type FrappeHrClient } from "./frappe-hr-client";

/**
 * Runs one Frappe HR -> workPulse sync pass. Idempotent and safe to run on
 * a schedule (default: every 2 hours, see FRAPPE_SYNC_CRON in .env.example)
 * or manually via `npm run sync:frappe-hr`.
 *
 * Departments are synced before Employees so employee.departmentId foreign
 * keys always resolve. Manager linkage is applied in a second pass over
 * Employees, since a manager may appear later in the source list than their
 * report.
 */
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

      await prisma.employee.upsert({
        where: { frappeEmployeeId: emp.employeeId },
        create: {
          frappeEmployeeId: emp.employeeId,
          name: emp.fullName,
          email: emp.email,
          designation: emp.designation,
          isActive: emp.isActive,
          departmentId: department?.id,
        },
        update: {
          name: emp.fullName,
          email: emp.email,
          designation: emp.designation,
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
        where: { frappeEmployeeId: emp.managerEmployeeId },
      });
      if (manager) {
        await prisma.employee.update({
          where: { frappeEmployeeId: emp.employeeId },
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
    mode: (process.env.FRAPPE_SYNC_MODE as "mock" | "live") ?? "mock",
    employeesSynced,
    departmentsSynced,
    errors,
  };
}
