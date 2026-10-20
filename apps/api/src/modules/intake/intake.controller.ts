import { BadRequestException, Body, Controller, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { Roles } from "../auth/roles.decorator";
import type { AuthenticatedUser } from "../auth/identity.service";
import { IntakeService } from "./intake.service";

/**
 * Where work arrives from another system.
 *
 * REST rather than tRPC because the callers are not this application: an issue
 * tracker, a support desk, a compliance system. They should not need a typed
 * client or to know anything about tRPC's batching.
 *
 * Authentication reuses what is already here rather than inventing a second
 * scheme. The caller signs in as a Synapse service account whose role maps to
 * INTEGRATION_SERVICE - a role that exists for exactly this and is refused to
 * any user linked to an employee record - and sends its Synapse token as a
 * bearer. That means a revoked integration stops working on its next request,
 * the same as a revoked person, and there is no separate secret to rotate,
 * leak or forget about.
 */
const intakeSchema = z.object({
  sourceSystemCode: z.string().min(1).max(40),
  /** The originating record's id. Also the idempotency key. */
  sourceReference: z.string().min(1).max(200),
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  priority: z.enum(["CRITICAL", "URGENT", "HIGH", "MEDIUM", "LOW"]).optional(),
  taskTypeCode: z.string().max(40).optional(),
  assigneeEmail: z.string().max(200).optional(),
  departmentName: z.string().max(200).optional(),
  dueDate: z.string().datetime().optional(),
});

@Controller("intake")
@Roles("INTEGRATION_SERVICE", "SYSTEM_ADMIN")
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  /** What a caller may post, so an integrator can check their payload. */
  @Get("schema")
  schema() {
    return {
      required: ["sourceSystemCode", "sourceReference", "title"],
      optional: [
        "description",
        "priority (CRITICAL|URGENT|HIGH|MEDIUM|LOW)",
        "taskTypeCode",
        "assigneeEmail",
        "departmentName",
        "dueDate (ISO 8601)",
      ],
      notes: [
        "sourceReference is the idempotency key: posting it twice returns the first task rather than creating a second.",
        "Supply assigneeEmail or departmentName. Without either, the event is refused rather than queued nowhere.",
        "An unambiguous email match routes to that person; a shared mailbox falls back to the department queue.",
      ],
    };
  }

  /**
   * Raise work from another system.
   *
   * Returns 200 with `created: false` for a redelivery rather than an error,
   * because at-least-once delivery is the normal case for webhooks and a
   * caller that gets an error for a duplicate will retry it forever.
   */
  @Post()
  async ingest(@Req() req: Request, @Body() body: unknown) {
    const parsed = intakeSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new BadRequestException(
        `${first.path.join(".") || "payload"}: ${first.message}`,
      );
    }

    const actor = (req as Request & { workPulseUser: AuthenticatedUser }).workPulseUser;
    const { task, created } = await this.intake.ingest({
      ...parsed.data,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
    });

    return {
      created,
      reference: task.reference,
      taskId: task.id,
      status: task.status,
      // Echoed so the caller can store the link back without guessing our URLs.
      acceptedBy: actor.username,
    };
  }
}
