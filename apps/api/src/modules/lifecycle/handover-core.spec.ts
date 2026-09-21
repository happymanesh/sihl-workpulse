import { DaciRole, HandoverItemType, HandoverReason, Priority } from "@workpulse/db";
import { decideFor, needsDualApproval, type HandoverContext, type HeldItem } from "./handover-core";

const OLD_DEPT = "dept-old";
const NEW_DEPT = "dept-new";

const ctx = (reason: HandoverReason): HandoverContext => ({ reason, fromDepartmentId: OLD_DEPT });
const EXIT = ctx(HandoverReason.EXIT);
const MOVE = ctx(HandoverReason.INTERNAL_TRANSFER);
const ROLE = ctx(HandoverReason.ROLE_CHANGE);

const task = (over: Partial<HeldItem> = {}): HeldItem => ({
  itemType: HandoverItemType.OPEN_TASK,
  priority: Priority.MEDIUM,
  taskTypeCode: "OPERATIONAL",
  taskDepartmentId: OLD_DEPT,
  fromOutgoingDeskCard: false,
  ...over,
});

describe("the desk card", () => {
  const card: HeldItem = { itemType: HandoverItemType.DESK_CARD_HOLDER };

  it.each([
    ["an exit", EXIT],
    ["a transfer", MOVE],
    ["a role change", ROLE],
  ])("always moves and always blocks on %s", (_label, c) => {
    // A desk card belongs to the seat, never to the person. An unoccupied one
    // stops generating its recurring obligations and nobody notices for a month.
    expect(decideFor(card, c)).toEqual({ disposition: "HAND_OVER", isBlocking: true });
  });
});

describe("open tasks", () => {
  describe("when the person is leaving", () => {
    it("hands over everything", () => {
      expect(decideFor(task(), EXIT).disposition).toBe("HAND_OVER");
      expect(decideFor(task({ taskDepartmentId: NEW_DEPT }), EXIT).disposition).toBe("HAND_OVER");
    });

    it("blocks on critical work", () => {
      expect(decideFor(task({ priority: Priority.CRITICAL }), EXIT).isBlocking).toBe(true);
    });

    it("blocks on management work at any priority", () => {
      expect(decideFor(task({ taskTypeCode: "MANAGEMENT", priority: Priority.LOW }), EXIT).isBlocking).toBe(true);
    });

    it("does not block on routine work", () => {
      // Blocking everything would make exits impossible.
      expect(decideFor(task(), EXIT).isBlocking).toBe(false);
    });
  });

  describe("when the person is moving department", () => {
    it("hands over work belonging to the department they are leaving", () => {
      expect(decideFor(task({ taskDepartmentId: OLD_DEPT }), MOVE).disposition).toBe("HAND_OVER");
    });

    it("lets them carry work that is not the old department's", () => {
      // This is the difference that matters: they are still here, still doing it.
      expect(decideFor(task({ taskDepartmentId: NEW_DEPT }), MOVE).disposition).toBe("RETAINED");
      expect(decideFor(task({ taskDepartmentId: null }), MOVE).disposition).toBe("RETAINED");
    });

    it("hands over work the outgoing desk card generated, wherever it sits", () => {
      expect(
        decideFor(task({ taskDepartmentId: NEW_DEPT, fromOutgoingDeskCard: true }), MOVE).disposition,
      ).toBe("HAND_OVER");
    });

    it("still blocks on critical work that has to change hands", () => {
      expect(
        decideFor(task({ priority: Priority.CRITICAL, taskDepartmentId: OLD_DEPT }), MOVE).isBlocking,
      ).toBe(true);
    });

    it("does not block on critical work they are keeping", () => {
      // Nothing to wait for - it is not going anywhere.
      const v = decideFor(task({ priority: Priority.CRITICAL, taskDepartmentId: NEW_DEPT }), MOVE);
      expect(v).toEqual({ disposition: "RETAINED", isBlocking: false });
    });
  });

  describe("when the person changes seat within the department", () => {
    it("moves only what the outgoing desk card generated", () => {
      expect(decideFor(task({ fromOutgoingDeskCard: true }), ROLE).disposition).toBe("HAND_OVER");
      expect(decideFor(task({ fromOutgoingDeskCard: false }), ROLE).disposition).toBe("RETAINED");
    });

    it("does not strip them of departmental work just because the seat changed", () => {
      // Same department, so taskDepartmentId matching must NOT trigger handover.
      expect(decideFor(task({ taskDepartmentId: OLD_DEPT }), ROLE).disposition).toBe("RETAINED");
    });
  });
});

describe("project roles", () => {
  const accountable: HeldItem = { itemType: HandoverItemType.RACI_ROLE, raciRole: "ACCOUNTABLE" };
  const consulted: HeldItem = { itemType: HandoverItemType.RACI_ROLE, raciRole: "CONSULTED" };

  it("stays with the person when they are staying at SIHL", () => {
    // Someone moving desks is usually still on the project. Taking it away
    // would leave the project without an owner for no reason.
    expect(decideFor(accountable, MOVE)).toEqual({ disposition: "RETAINED", isBlocking: false });
    expect(decideFor(accountable, ROLE).disposition).toBe("RETAINED");
  });

  it("must be reassigned when they leave, and accountability blocks", () => {
    expect(decideFor(accountable, EXIT)).toEqual({ disposition: "HAND_OVER", isBlocking: true });
    expect(decideFor(consulted, EXIT)).toEqual({ disposition: "HAND_OVER", isBlocking: false });
  });
});

describe("decision roles", () => {
  const openApprover: HeldItem = {
    itemType: HandoverItemType.DACI_ROLE,
    daciRole: DaciRole.APPROVER,
    decisionIsOpen: true,
  };

  it("blocks an exit while a decision they must approve is still open", () => {
    // Otherwise the decision can never be closed by anybody.
    expect(decideFor(openApprover, EXIT).isBlocking).toBe(true);
  });

  it("does not block once the decision is settled", () => {
    expect(decideFor({ ...openApprover, decisionIsOpen: false }, EXIT).isBlocking).toBe(false);
  });

  it("is kept on an internal move", () => {
    expect(decideFor(openApprover, MOVE)).toEqual({ disposition: "RETAINED", isBlocking: false });
  });
});

describe("owned controls", () => {
  it.each([HandoverItemType.PROCESS_OWNER, HandoverItemType.POLICY_OWNER])(
    "%s always moves and always blocks",
    (itemType) => {
      // An unowned control is a compliance gap whether the owner left the
      // company or just the floor.
      for (const c of [EXIT, MOVE, ROLE]) {
        expect(decideFor({ itemType }, c)).toEqual({ disposition: "HAND_OVER", isBlocking: true });
      }
    },
  );
});

describe("informational items", () => {
  it("lists recurring activities without blocking — they follow their desk card", () => {
    expect(decideFor({ itemType: HandoverItemType.RECURRING_ACTIVITY }, EXIT).isBlocking).toBe(false);
  });

  it("lists cover arrangements without blocking", () => {
    expect(decideFor({ itemType: HandoverItemType.DELEGATION }, EXIT).isBlocking).toBe(false);
  });
});

describe("the invariant that prevents a deadlock", () => {
  it("never returns a retained item that blocks", () => {
    // A blocking retained item would be a condition nobody could ever satisfy:
    // there is no second party to transfer it to.
    const everything: HeldItem[] = [
      task({ taskDepartmentId: NEW_DEPT, priority: Priority.CRITICAL }),
      task({ taskDepartmentId: NEW_DEPT, taskTypeCode: "MANAGEMENT" }),
      { itemType: HandoverItemType.RACI_ROLE, raciRole: "ACCOUNTABLE" },
      { itemType: HandoverItemType.DACI_ROLE, daciRole: DaciRole.APPROVER, decisionIsOpen: true },
    ];
    for (const c of [EXIT, MOVE, ROLE]) {
      for (const item of everything) {
        const v = decideFor(item, c);
        if (v.disposition === "RETAINED") expect(v.isBlocking).toBe(false);
      }
    }
  });
});

describe("dual sign-off", () => {
  it("is required only for an internal transfer", () => {
    // An exit has no receiving manager; a role change stays under the same one.
    expect(needsDualApproval(HandoverReason.INTERNAL_TRANSFER)).toBe(true);
    expect(needsDualApproval(HandoverReason.EXIT)).toBe(false);
    expect(needsDualApproval(HandoverReason.ROLE_CHANGE)).toBe(false);
  });
});
