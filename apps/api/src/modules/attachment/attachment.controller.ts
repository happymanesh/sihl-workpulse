import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { TaskAttachmentKind } from "@workpulse/db";
import type { Request, Response } from "express";
import type { AuthenticatedUser } from "../auth/identity.service";
import { MAX_ATTACHMENT_BYTES } from "./attachment-core";
import { AttachmentService } from "./attachment.service";

/**
 * REST rather than tRPC, for the same reason dictation is: these carry files.
 * tRPC serialises JSON, so an upload would mean base64 in a JSON body and a
 * download would mean the whole file in memory on both sides.
 *
 * Listing and withdrawing stay on tRPC, where the typed client belongs.
 */
@Controller("attachments")
export class AttachmentController {
  constructor(private readonly attachments: AttachmentService) {}

  /** Resolved by the global SynapseAuthGuard; these routes are not @Public(). */
  private actor(req: Request): AuthenticatedUser {
    return (req as Request & { workPulseUser: AuthenticatedUser }).workPulseUser;
  }

  @Post(":taskId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async upload(
    @Req() req: Request,
    @Param("taskId") taskId: string,
    @Query("kind") kind?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("No file was received");

    return this.attachments.add(this.actor(req), {
      taskId,
      fileName: file.originalname,
      contentType: file.mimetype,
      bytes: file.buffer,
      kind: kind === "REFERENCE" ? TaskAttachmentKind.REFERENCE : TaskAttachmentKind.EVIDENCE,
    });
  }

  @Get(":id/download")
  async download(@Req() req: Request, @Res() res: Response, @Param("id") id: string) {
    const { stream, fileName, contentType, sizeBytes } = await this.attachments.open(
      this.actor(req),
      id,
    );

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(sizeBytes));
    // attachment, never inline: an HTML or SVG file rendered in place would run
    // in the app's own origin. Everything here downloads.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");

    stream.pipe(res);
  }
}
