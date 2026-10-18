import { TaskStatus } from "@workpulse/db";
import {
  MAX_ATTACHMENT_BYTES,
  canRemove,
  sanitiseFileName,
  storageKeyFor,
  validateUpload,
} from "./attachment-core";

describe("attachment rules", () => {
  describe("what may be attached", () => {
    it("accepts the documents a desk actually produces", () => {
      for (const [name, type] of [
        ["SEBI filing.pdf", "application/pdf"],
        ["reco 31-03.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        ["screenshot.png", "image/png"],
        ["exchange confirmation.eml", "message/rfc822"],
      ]) {
        expect(validateUpload({ fileName: name, contentType: type, sizeBytes: 2048 })).toMatchObject({
          ok: true,
        });
      }
    });

    it("refuses an archive, and says what is accepted", () => {
      const v = validateUpload({ fileName: "evidence.zip", contentType: "application/zip", sizeBytes: 100 });
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.reason).toContain(".pdf");
        expect(v.reason).toContain(".zip cannot be attached");
      }
    });

    it("refuses an executable however it is announced", () => {
      expect(
        validateUpload({ fileName: "setup.exe", contentType: "application/pdf", sizeBytes: 100 }).ok,
      ).toBe(false);
    });

    it("refuses a file whose type contradicts its name", () => {
      const v = validateUpload({
        fileName: "statement.pdf",
        contentType: "text/html",
        sizeBytes: 100,
      });
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toMatch(/says it is text\/html/);
    });

    it("trusts the extension when the browser reports nothing useful", () => {
      expect(
        validateUpload({ fileName: "note.msg", contentType: "application/octet-stream", sizeBytes: 10 }).ok,
      ).toBe(true);
      expect(validateUpload({ fileName: "note.pdf", contentType: "", sizeBytes: 10 }).ok).toBe(true);
    });

    it("refuses an empty file and one over the limit", () => {
      expect(validateUpload({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 0 }).ok).toBe(
        false,
      );
      const big = validateUpload({
        fileName: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: MAX_ATTACHMENT_BYTES + 1,
      });
      expect(big.ok).toBe(false);
      if (!big.ok) expect(big.reason).toContain("25 MB");
    });

    it("keeps a readable name but never a path", () => {
      expect(sanitiseFileName("C:\\\\Users\\\\rohan\\\\Q4 reco (final).xlsx")).toBe("Q4 reco (final).xlsx");
      expect(sanitiseFileName("../../etc/passwd")).toBe("passwd");
      expect(sanitiseFileName("...hidden.pdf")).toBe("hidden.pdf");
      expect(sanitiseFileName("नोट.pdf")).toBe("नोट.pdf");
    });

    it("stores by checksum, fanned out so no directory grows unbounded", () => {
      expect(storageKeyFor("abcdef0123456789")).toBe("ab/cd/abcdef0123456789");
    });
  });

  describe("what may be withdrawn", () => {
    const base = {
      taskStatus: TaskStatus.IN_PROGRESS,
      uploadedByEmployeeId: "e1",
      alreadyRemoved: false,
      actorEmployeeId: "e1",
      actorCanGovern: false,
    };

    it("lets the uploader withdraw their own mistake", () => {
      expect(canRemove(base).allowed).toBe(true);
    });

    it("refuses a colleague", () => {
      expect(canRemove({ ...base, actorEmployeeId: "e2" }).allowed).toBe(false);
    });

    it("lets a governance role withdraw anybody's", () => {
      expect(canRemove({ ...base, actorEmployeeId: "e2", actorCanGovern: true }).allowed).toBe(true);
    });

    it.each([TaskStatus.VERIFIED, TaskStatus.CLOSED])(
      "refuses everybody once the task is %s, governance included",
      (status) => {
        const v = canRemove({ ...base, taskStatus: status, actorCanGovern: true });
        expect(v.allowed).toBe(false);
        if (!v.allowed) expect(v.reason).toMatch(/part of the record/);
      },
    );

    it("will not withdraw the same file twice", () => {
      expect(canRemove({ ...base, alreadyRemoved: true }).allowed).toBe(false);
    });
  });
});
