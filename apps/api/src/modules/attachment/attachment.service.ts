import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { TaskAttachmentKind, WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";
import { canViewTask } from "../analytics/visibility-core";
import { MAX_ATTACHMENT_BYTES, canRemove, validateUpload } from "./attachment-core";
import { AttachmentStorage } from "./attachment.storage";

/**
 * Files attached to a task.
 *
 * An attachment is evidence, so the shape of this service follows from that:
 * there is no update, removal marks rather than deletes, and every upload,
 * withdrawal and download is audited. What was attached to a piece of work when
 * somebody signed it off has to be answerable later, and a row that could be
 * edited or deleted could not answer it.
 *
 * Who may see an attachment follows the task itself, confidentiality included,
 * so an attachment cannot become a way around visibility.
 */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly audit: AuditService,
    private readonly storage: AttachmentStorage,
  ) {}

  private canGovern(actor: AuthenticatedUser): boolean {
    return (
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD)
    );
  }

  private async loadTaskFor(actor: AuthenticatedUser, taskId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        reference: true,
        status: true,
        isConfidential: true,
        assigneeEmployeeId: true,
        reviewerEmployeeId: true,
      },
    });
    if (!task) throw new NotFoundException("Task not found");

    const verdict = canViewTask(
      { employeeId: actor.employeeId, roles: actor.roles, managedEmployeeIds: [] },
      {
        isConfidential: task.isConfidential,
        assigneeEmployeeId: task.assigneeEmployeeId,
        reviewerEmployeeId: task.reviewerEmployeeId,
      },
    );
    if (!verdict.canView) {
      throw new ForbiddenException(
        "You cannot see this task, so you cannot read or add files on it",
      );
    }

    return task;
  }

  /**
   * Withdrawn files are listed too, marked as withdrawn and without a download.
   * Hiding them would make the list disagree with the audit trail, and somebody
   * reading back a disputed closure needs to see that a file was attached and
   * taken off again.
   */
  async list(actor: AuthenticatedUser, taskId: string) {
    await this.loadTaskFor(actor, taskId);
    return prisma.taskAttachment.findMany({
      where: { taskId },
      include: { uploadedBy: { select: { id: true, name: true, designation: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async add(
    actor: AuthenticatedUser,
    input: {
      taskId: string;
      fileName: string;
      contentType: string;
      bytes: Buffer;
      kind?: TaskAttachmentKind;
    },
  ) {
    const task = await this.loadTaskFor(actor, input.taskId);

    if (!actor.employeeId) {
      throw new BadRequestException(
        "Your workPulse account is not linked to an employee record, so a file cannot be attributed to anybody.",
      );
    }

    const verdict = validateUpload({
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
    });
    if (!verdict.ok) {
      if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new PayloadTooLargeException(verdict.reason);
      }
      throw new BadRequestException(verdict.reason);
    }

    const { checksum, storageKey, deduplicated } = await this.storage.write(input.bytes);

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId: input.taskId,
        uploadedByEmployeeId: actor.employeeId,
        uploadedByUserId: actor.id,
        fileName: verdict.fileName,
        contentType: input.contentType || "application/octet-stream",
        sizeBytes: input.bytes.byteLength,
        checksum,
        storageKey,
        kind: input.kind ?? TaskAttachmentKind.EVIDENCE,
      },
      include: { uploadedBy: { select: { id: true, name: true, designation: true } } },
    });

    await this.audit.record({
      entityType: "Task",
      entityId: input.taskId,
      action: "attachment_added",
      actorId: actor.id,
      after: {
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        checksum,
        kind: attachment.kind,
        // Says that these bytes were already held under this checksum, which is
        // how "the same file was attached to another task" gets answered.
        deduplicated,
      },
      reason: `${task.reference}: ${attachment.fileName} attached`,
    });

    return attachment;
  }

  async remove(actor: AuthenticatedUser, input: { attachmentId: string; reason: string }) {
    const attachment = await prisma.taskAttachment.findUnique({
      where: { id: input.attachmentId },
      include: { task: { select: { id: true, reference: true, status: true } } },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");

    await this.loadTaskFor(actor, attachment.taskId);

    if (!input.reason?.trim()) {
      throw new BadRequestException("Withdrawing a file needs a reason — it stays in the record either way");
    }

    const verdict = canRemove({
      taskStatus: attachment.task.status,
      uploadedByEmployeeId: attachment.uploadedByEmployeeId,
      alreadyRemoved: Boolean(attachment.removedAt),
      actorEmployeeId: actor.employeeId,
      actorCanGovern: this.canGovern(actor),
    });
    if (!verdict.allowed) throw new ForbiddenException(verdict.reason);

    const updated = await prisma.taskAttachment.update({
      where: { id: input.attachmentId },
      data: {
        removedAt: new Date(),
        removedByUserId: actor.id,
        removalReason: input.reason.trim(),
      },
      include: { uploadedBy: { select: { id: true, name: true, designation: true } } },
    });

    await this.audit.record({
      entityType: "Task",
      entityId: attachment.taskId,
      action: "attachment_withdrawn",
      actorId: actor.id,
      before: { attachmentId: attachment.id, fileName: attachment.fileName, removedAt: null },
      after: { attachmentId: attachment.id, fileName: attachment.fileName, removedAt: updated.removedAt },
      reason: `${attachment.task.reference}: ${input.reason.trim()}`,
    });

    return updated;
  }

  /**
   * Hand back the bytes, after checking the reader may see the task.
   *
   * Downloads are audited. At a regulated firm, who looked at the evidence on a
   * disputed closure is a real question, and the answer costs one row.
   */
  async open(actor: AuthenticatedUser, attachmentId: string) {
    const attachment = await prisma.taskAttachment.findUnique({
      where: { id: attachmentId },
      include: { task: { select: { id: true, reference: true } } },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");

    await this.loadTaskFor(actor, attachment.taskId);

    if (attachment.removedAt) {
      throw new NotFoundException(
        "That file was withdrawn. The record shows it was attached and by whom; the file itself is no longer served.",
      );
    }

    if (!(await this.storage.exists(attachment.storageKey))) {
      throw new NotFoundException(
        "The record of this file is intact but the file itself is missing from storage. Report this — it should not happen.",
      );
    }

    await this.audit.record({
      entityType: "Task",
      entityId: attachment.taskId,
      action: "attachment_downloaded",
      actorId: actor.id,
      after: { attachmentId: attachment.id, fileName: attachment.fileName },
      reason: `${attachment.task.reference}: ${attachment.fileName} downloaded`,
    });

    return {
      stream: this.storage.readStream(attachment.storageKey),
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
    };
  }

  /** Whether a task carries a file of the kind the closure check counts. */
  async hasEvidence(taskId: string): Promise<boolean> {
    const count = await prisma.taskAttachment.count({
      where: { taskId, kind: TaskAttachmentKind.EVIDENCE, removedAt: null },
    });
    return count > 0;
  }
}
