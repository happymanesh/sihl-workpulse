import { Injectable } from "@nestjs/common";
import { prisma } from "@workpulse/db";
import type { EmployeeSummary } from "@workpulse/shared-types";

/**
 * Read-only service over the Employee cache. There is deliberately no
 * create/update/delete here - Employee/Department are written exclusively
 * by the Frappe HR sync job (src/jobs/frappe-hr-sync.job.ts). See BRS
 * Section 4.2: Frappe HR is the single source of truth, workPulse never
 * becomes a second place employee data can drift from.
 */
@Injectable()
export class EmployeeService {
  async list(params: { departmentId?: string; activeOnly?: boolean } = {}): Promise<EmployeeSummary[]> {
    const employees = await prisma.employee.findMany({
      where: {
        departmentId: params.departmentId,
        isActive: params.activeOnly ? true : undefined,
      },
      include: { department: true },
      orderBy: { name: "asc" },
    });

    return employees.map((e) => ({
      id: e.id,
      name: e.name,
      email: e.email,
      designation: e.designation,
      departmentName: e.department?.name ?? null,
      isActive: e.isActive,
    }));
  }

  async findById(id: string): Promise<EmployeeSummary | null> {
    const e = await prisma.employee.findUnique({ where: { id }, include: { department: true } });
    if (!e) return null;
    return {
      id: e.id,
      name: e.name,
      email: e.email,
      designation: e.designation,
      departmentName: e.department?.name ?? null,
      isActive: e.isActive,
    };
  }
}
