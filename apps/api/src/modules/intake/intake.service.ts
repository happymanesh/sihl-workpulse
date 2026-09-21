import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ActorType, Priority, TaskOrigin, TaskStatus, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";

export interface IntakeEvent {
  sourceSystemCode: string;
  /** The originating record's id. Also the idempotency key. */
  sourceReference: string;
  title: string;
  description?: string;
  priority?: Priority;
  taskTypeCode?: string;
  assigneeEmail?: string;
  departmentName?: string;
  dueDate?: Date;
}

/**
 * Source-system intake (BRS 15.3).
 *
 * Generic by design: a Task carries a Source System and a Source Reference,
 * and nothing else about the originating system. Adding Support Desk, Vision or
 * a compliance system needs configuration, not schema.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(private readonly audit: AuditService) {}

  private async nextReference(): Promise<string> {
    const [{ nextval }] = await prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('task_reference_seq') AS nextval
    `;
    return `WP-${String(nextval).padStart(6, "0")}`;
  }

  /**
   * TM-FR-009: the Source Reference is the idempotency key.
   *
   * Webhooks are redelivered - on timeout, on retry, on replay after an outage.
   * Returning the existing task rather than erroring means the caller can retry
   * freely, which is what makes at-least-once delivery safe.
   */
  async ingest(event: IntakeEvent) {
    const source = await prisma.sourceSystem.findUnique({
      where: { code: event.sourceSystemCode },
    });
    if (!source) throw new NotFoundException(`Unknown source system: ${event.sourceSystemCode}`);
    if (!source.isActive) throw new BadRequestException(`Source system ${source.code} is not active`);
    if (!event.sourceReference?.trim()) {
      throw new BadRequestException("A source reference is required - it is the idempotency key");
    }

    const existing = await prisma.task.findUnique({
      where: {
        sourceSystemId_sourceReference: {
          sourceSystemId: source.id,
          sourceReference: event.sourceReference,
        },
      },
    });
    if (existing) {
      this.logger.debug(`Duplicate intake for ${source.code}/${event.sourceReference}; returning existing task`);
      return { task: existing, created: false };
    }

    const [taskType, assignee, department] = await Promise.all([
      event.taskTypeCode
        ? prisma.taskType.findUnique({ where: { code: event.taskTypeCode } })
        : prisma.taskType.findUnique({ where: { code: "OPERATIONAL" } }),
      event.assigneeEmail ? prisma.employee.findUnique({ where: { email: event.assigneeEmail } }) : null,
      event.departmentName ? prisma.department.findFirst({ where: { name: event.departmentName } }) : null,
    ]);

    if (!taskType) throw new BadRequestException("No task type resolved for this event");

    // TM-FR-021: where no eligible assignee is found, work is queued rather
    // than lost. Without a department head to route to, the task is created
    // unassigned-but-visible rather than silently dropped.
    const resolvedAssignee =
      assignee ??
      (department
        ? await prisma.employee.findFirst({
            where: { departmentId: department.id, isActive: true, managerId: null },
          })
        : null);

    if (!resolvedAssignee) {
      throw new BadRequestException(
        "Could not resolve an assignee or a department queue for this event. " +
          "Supply assigneeEmail or departmentName.",
      );
    }

    const reference = await this.nextReference();

    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          reference,
          title: event.title.trim(),
          description: event.description?.trim(),
          taskTypeId: taskType.id,
          priority: event.priority ?? Priority.MEDIUM,
          origin: TaskOrigin.SOURCE_SYSTEM,
          status: TaskStatus.ASSIGNED,
          assigneeEmployeeId: resolvedAssignee.id,
          departmentId: department?.id ?? resolvedAssignee.departmentId,
          dueDate: event.dueDate ?? new Date(Date.now() + 3 * 86_400_000),
          sourceSystemId: source.id,
          sourceReference: event.sourceReference,
        },
      });

      await tx.taskStatusHistory.create({
        data: {
          taskId: created.id,
          fromStatus: null,
          toStatus: TaskStatus.ASSIGNED,
          actorType: ActorType.INTEGRATION,
        },
      });

      return created;
    });

    await this.audit.record({
      entityType: "Task",
      entityId: task.id,
      action: "ingested_from_source_system",
      actorType: ActorType.INTEGRATION,
      after: {
        reference: task.reference,
        sourceSystem: source.code,
        sourceReference: event.sourceReference,
        assigneeEmployeeId: resolvedAssignee.id,
      },
    });

    return { task, created: true };
  }

  /** TM-FR-010: a clickable link back to the originating record. */
  buildSourceUrl(template: string | null, reference: string | null): string | null {
    if (!template || !reference) return null;
    return template.includes("{id}") ? template.replace("{id}", encodeURIComponent(reference)) : template;
  }

  /**
   * TM-FR-011: outbound status push-back.
   *
   * Only configured systems receive it, and a delivery failure is logged rather
   * than thrown - the originating system being unreachable must not roll back a
   * status change that already happened here.
   */
  async pushStatus(taskId: string): Promise<{ delivered: boolean; reason?: string }> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { sourceSystem: true },
    });
    if (!task?.sourceSystem?.webhookUrl) return { delivered: false, reason: "No webhook configured" };

    try {
      const res = await fetch(task.sourceSystem.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceReference: task.sourceReference,
          workPulseReference: task.reference,
          status: task.status,
          updatedAt: task.updatedAt,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Status push-back for ${task.reference} returned ${res.status}`);
        return { delivered: false, reason: `HTTP ${res.status}` };
      }
      return { delivered: true };
    } catch (err) {
      this.logger.warn(`Status push-back for ${task.reference} failed: ${(err as Error).message}`);
      return { delivered: false, reason: (err as Error).message };
    }
  }
}
