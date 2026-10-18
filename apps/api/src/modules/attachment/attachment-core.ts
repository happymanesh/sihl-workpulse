import { TaskStatus } from "@workpulse/db";

/**
 * What may be attached to a task, and what may be taken back off it.
 *
 * Dependency-free on purpose, like the other -core modules: these are the rules
 * an auditor would ask about, and they are worth testing without a database in
 * the way.
 *
 * The shape of the policy matters more than the individual values. An
 * allow-list, not a block-list: a block-list of dangerous extensions is a list
 * of the ones somebody thought of, and the first one nobody thought of is the
 * one that matters. Evidence at a broker is documents, images and spreadsheets;
 * anything else is refused and the person is told what is accepted.
 */

/** Anything larger is refused before it is written anywhere. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Accepted extensions, each with the content types a browser plausibly reports
 * for it. The extension decides; the content type is checked against it so a
 * .pdf announced as something else is refused rather than quietly trusted.
 *
 * Archives are deliberately absent. A zip is opaque to a reviewer — it proves
 * nothing until somebody extracts it, and by then the check has moved outside
 * the system.
 */
export const ALLOWED_TYPES: Readonly<Record<string, readonly string[]>> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  heic: ["image/heic", "image/heif"],
  txt: ["text/plain"],
  csv: ["text/csv", "application/csv", "text/plain"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  msg: ["application/vnd.ms-outlook", "application/octet-stream"],
  eml: ["message/rfc822"],
};

export const ACCEPTED_EXTENSIONS = Object.keys(ALLOWED_TYPES);

export interface UploadCandidate {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export type UploadVerdict =
  | { ok: true; fileName: string; extension: string }
  | { ok: false; reason: string };

/**
 * The name is sanitised rather than rejected. People name files from the
 * desks they sit at — spaces, brackets, a client's name, the odd Gujarati
 * character — and refusing those would teach them to rename before uploading
 * instead of telling us anything about safety. Safety comes from never using
 * this name as a path: the bytes are stored under their checksum, and this is
 * display only.
 */
export function sanitiseFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  return base
    // Control characters are the point of this one: a name carrying a newline
    // or an escape sequence can rewrite a log line or a terminal.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
}

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i === -1 ? "" : fileName.slice(i + 1).toLowerCase();
}

export function validateUpload(candidate: UploadCandidate): UploadVerdict {
  const fileName = sanitiseFileName(candidate.fileName);
  if (!fileName) return { ok: false, reason: "That file has no usable name" };

  if (candidate.sizeBytes <= 0) {
    return { ok: false, reason: "That file is empty" };
  }
  if (candidate.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `Attachments are limited to ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB. Link to the document instead, or attach the page that matters.`,
    };
  }

  const extension = extensionOf(fileName);
  const allowed = ALLOWED_TYPES[extension];
  if (!allowed) {
    return {
      ok: false,
      reason: `A ${extension ? `.${extension}` : "file with no extension"} cannot be attached. Accepted: ${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`,
    };
  }

  // A browser that reports nothing is not treated as a liar - it is treated as
  // a browser. The extension still had to be on the list to get here.
  const declared = candidate.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (declared && declared !== "application/octet-stream" && !allowed.includes(declared)) {
    return {
      ok: false,
      reason: `That file says it is ${declared} but is named .${extension}. Rename it to match what it actually is.`,
    };
  }

  return { ok: true, fileName, extension };
}

/**
 * Where the bytes live, relative to the attachment root.
 *
 * Content-addressed and fanned out two levels, so the same file attached to
 * forty tasks costs one copy and no directory ends up with a hundred thousand
 * entries in it.
 */
export function storageKeyFor(checksum: string): string {
  return `${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}`;
}

export interface RemovalContext {
  taskStatus: TaskStatus;
  uploadedByEmployeeId: string;
  alreadyRemoved: boolean;
  actorEmployeeId: string | null;
  actorCanGovern: boolean;
}

export type RemovalVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Once work has been verified or closed, what was attached to it is part of the
 * record somebody signed off against, so nothing may be taken off it - not by
 * the uploader, not by a department head. Before that, the uploader can withdraw
 * their own mistake and a governance role can withdraw anybody's, always with a
 * reason, and the row stays either way.
 */
export const SETTLED_STATUSES: readonly TaskStatus[] = [TaskStatus.VERIFIED, TaskStatus.CLOSED];

export function canRemove(ctx: RemovalContext): RemovalVerdict {
  if (ctx.alreadyRemoved) {
    return { allowed: false, reason: "That attachment has already been withdrawn" };
  }
  if (SETTLED_STATUSES.includes(ctx.taskStatus)) {
    return {
      allowed: false,
      reason:
        "This task has been verified or closed, so what was attached to it is part of the record and cannot be withdrawn. Attach a correction instead.",
    };
  }
  if (ctx.actorCanGovern) return { allowed: true };
  if (ctx.actorEmployeeId && ctx.actorEmployeeId === ctx.uploadedByEmployeeId) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "Only the person who attached a file, or a Department Head, can withdraw it",
  };
}
