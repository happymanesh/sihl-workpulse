import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { prisma, type TaskStatus } from "@workpulse/db";
import type { AuthenticatedUser } from "../auth/identity.service";
import { notificationsForTransition, type TaskForNotification } from "./notification-core";

/**
 * Telling people things.
 *
 * Writing rows is the easy half; the half that matters is that a failure here
 * must never undo the thing being announced. Verifying a task is the real
 * event - the notification is a courtesy - so this logs and swallows rather
 * than throwing into a transition that has already happened.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  /** How many pile up before the bell stops counting precisely. */
  static readonly COUNT_CAP = 99;

  /**
   * Fan a transition out to whoever needs to know.
   *
   * Called after the transition has committed, on purpose: a notification
   * about something that then failed to happen is worse than no notification.
   */
  async announceTransition(input: {
    task: TaskForNotification & { id: string };
    to: TaskStatus;
    actorEmployeeId: string | null;
    reason?: string | null;
  }): Promise<void> {
    try {
      const drafts = notificationsForTransition(input);
      if (drafts.length === 0) return;

      await prisma.notification.createMany({
        data: drafts.map((d) => ({
          recipientEmployeeId: d.recipientEmployeeId,
          actorEmployeeId: input.actorEmployeeId,
          kind: d.kind,
          title: d.title,
          body: d.body,
          entityType: "Task",
          entityId: input.task.id,
        })),
      });
    } catch (e) {
      // Deliberately swallowed. The transition is already committed and is the
      // thing that matters; a failure to announce it is a degraded service,
      // not a reason to tell the user their action failed when it did not.
      this.logger.error(
        `Could not announce ${input.to} on task ${input.task.reference}: ${(e as Error).message}`,
      );
    }
  }

  async listMine(actor: AuthenticatedUser, params: { unreadOnly?: boolean; limit?: number } = {}) {
    if (!actor.employeeId) return [];
    return prisma.notification.findMany({
      where: {
        recipientEmployeeId: actor.employeeId,
        ...(params.unreadOnly ? { readAt: null } : {}),
      },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 30, 100),
    });
  }

  async unreadCount(actor: AuthenticatedUser): Promise<number> {
    if (!actor.employeeId) return 0;
    return prisma.notification.count({
      where: { recipientEmployeeId: actor.employeeId, readAt: null },
    });
  }

  /**
   * Mark one read.
   *
   * Scoped to the caller's own rows: the id alone must not be enough to touch
   * somebody else's notification, or to discover that it exists.
   */
  async markRead(actor: AuthenticatedUser, id: string) {
    if (!actor.employeeId) throw new NotFoundException("Notification not found");
    const { count } = await prisma.notification.updateMany({
      where: { id, recipientEmployeeId: actor.employeeId, readAt: null },
      data: { readAt: new Date() },
    });
    // Already read is success, not an error - two clicks should not fail.
    if (count === 0) {
      const exists = await prisma.notification.findFirst({
        where: { id, recipientEmployeeId: actor.employeeId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException("Notification not found");
    }
    return { id };
  }

  async markAllRead(actor: AuthenticatedUser) {
    if (!actor.employeeId) return { count: 0 };
    return prisma.notification.updateMany({
      where: { recipientEmployeeId: actor.employeeId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
