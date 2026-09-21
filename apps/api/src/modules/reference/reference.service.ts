import { Injectable } from "@nestjs/common";
import { prisma } from "@workpulse/db";

/**
 * Read-only lookups that populate pickers.
 *
 * Departments come from the Frappe HR cache and are never written here - the
 * sync job owns them (BRS Section 4.2). Task Types are workPulse's own master
 * data, currently seeded rather than user-managed; an admin screen for them
 * belongs with the Process/Policy work in Phase 3, where the governance flags
 * they carry start to matter.
 */
@Injectable()
export class ReferenceService {
  async taskTypes() {
    return prisma.taskType.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        requiresVerification: true,
        requiresEvidence: true,
        requiresMakerChecker: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async departments() {
    return prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
}
