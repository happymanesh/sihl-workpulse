import { Injectable } from "@nestjs/common";
import { prisma, ActorType, Prisma } from "@workpulse/db";

export interface RecordAuditEntryInput {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string;
  actorType?: ActorType;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string;
}

/**
 * The single write path into AuditLog. Section 19 of the BRS: every module
 * that mutates a Task, Project, Employee assignment, etc. should call this
 * rather than writing to AuditLog directly, so the "who/what/when/why"
 * shape stays consistent across the whole app.
 *
 * No delete/update methods exist on this service on purpose - the audit
 * trail is append-only at the application layer, not just by convention.
 */
@Injectable()
export class AuditService {
  async record(input: RecordAuditEntryInput): Promise<void> {
    await prisma.auditLog.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        actorId: input.actorId,
        actorType: input.actorType ?? ActorType.USER,
        beforeJson: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
        afterJson: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: input.reason,
      },
    });
  }

  async history(entityType: string, entityId: string) {
    return prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "asc" },
    });
  }
}
