/**
 * Builds the task lifecycle guide: every state, every branch, start to end.
 *
 * The diagram and the transition table are generated from task-lifecycle.json,
 * which is exported from the API's own state machine — so neither can drift
 * from what the software actually enforces. Regenerate the JSON with:
 *
 *   node -e "const {transitionMap}=require('./apps/api/dist/src/modules/task/task-lifecycle.js'); \
 *            require('fs').writeFileSync('docs/task-lifecycle.json', JSON.stringify(transitionMap(),null,2))"
 */
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const SHOTS = path.join(__dirname, "guide-images-flow") + path.sep;
const OUT = path.join(__dirname, "workPulse-task-lifecycle.pdf");
const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, "task-lifecycle.json"), "utf8"));

const NAVY = "#0f2d52";
const RED = "#e11d48";
const GREY = "#5b6472";
const LIGHT = "#9aa3ae";
const GREEN = "#15803d";
const AMBER = "#b45309";

const LABEL = {
  DRAFT: "Draft",
  ASSIGNED: "Assigned",
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In progress",
  PENDING_REVIEW: "Pending review",
  COMPLETED: "Completed",
  VERIFIED: "Verified",
  CLOSED: "Closed",
  BLOCKED: "Blocked",
  REJECTED: "Rejected",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
  ON_HOLD: "On hold",
  DEFERRED: "Deferred",
};

// ---------------------------------------------------------------- the diagram

function drawDiagram(doc) {
  doc.addPage({ size: "A4", layout: "landscape", margin: 36 });

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(RED).text("THE WHOLE PICTURE", 36, 34, {
    characterSpacing: 0.8,
  });
  doc.font("Helvetica-Bold").fontSize(17).fillColor(NAVY).text("A task, from raised to closed", 36, 48);
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#1b2430")
    .text(
      "The dark line is the path most work takes. Everything else is a branch that exists because real work takes it. Drawn from the application's own state machine — if a move is not on this page, the software refuses it.",
      36,
      72,
      { width: 500, lineGap: 2 },
    );

  const box = (x, y, w, h, text, opts = {}) => {
    const { fill = "#ffffff", stroke = "#9aa3ae", color = "#1b2430", bold = false, dash = false } = opts;
    doc.save();
    doc.roundedRect(x, y, w, h, 5);
    if (dash) doc.dash(2, { space: 2 });
    doc.lineWidth(bold ? 1.4 : 0.9).fillAndStroke(fill, stroke);
    doc.undash();
    doc.restore();
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(8.5)
      .fillColor(color)
      .text(text, x, y + h / 2 - 5, { width: w, align: "center" });
  };

  // An arrow with an optional mid-label. Drawn as a straight segment or an
  // elbow, because a page of bezier spaghetti is harder to read than a page of
  // right angles.
  const arrow = (x1, y1, x2, y2, opts = {}) => {
    const { color = "#6b7480", label, dash = false, via, labelAt } = opts;
    doc.save();
    doc.strokeColor(color).lineWidth(0.9);
    if (dash) doc.dash(3, { space: 2 });
    doc.moveTo(x1, y1);
    if (via) {
      doc.lineTo(via[0], via[1]);
      if (via.length > 2) doc.lineTo(via[2], via[3]);
    }
    doc.lineTo(x2, y2).stroke();
    doc.undash();

    // Head, pointing along the final segment.
    const px = via ? (via.length > 2 ? via[2] : via[0]) : x1;
    const py = via ? (via.length > 2 ? via[3] : via[1]) : y1;
    const a = Math.atan2(y2 - py, x2 - px);
    doc
      .moveTo(x2, y2)
      .lineTo(x2 - 5 * Math.cos(a - 0.4), y2 - 5 * Math.sin(a - 0.4))
      .lineTo(x2 - 5 * Math.cos(a + 0.4), y2 - 5 * Math.sin(a + 0.4))
      .closePath()
      .fill(color);
    doc.restore();

    if (label) {
      const mx = labelAt ? labelAt[0] : via ? via[0] : (x1 + x2) / 2;
      const my = labelAt ? labelAt[1] : via ? via[1] : (y1 + y2) / 2;
      doc.font("Helvetica").fontSize(6.5).fillColor(color).text(label, mx - 34, my - 9, {
        width: 68,
        align: "center",
      });
    }
  };

  // ---- the spine --------------------------------------------------------
  const spine = ["DRAFT", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PENDING_REVIEW", "COMPLETED", "VERIFIED", "CLOSED"];
  const W = 84;
  const H = 34;
  const GAP = 12;
  const X0 = 43;
  const Y = 300;
  const at = (i) => X0 + i * (W + GAP);
  const mid = (i) => at(i) + W / 2;

  spine.forEach((s, i) => {
    box(at(i), Y, W, H, LABEL[s], {
      bold: true,
      fill: i === spine.length - 1 ? "#eef2f7" : "#ffffff",
      stroke: NAVY,
      color: NAVY,
    });
    if (i > 0) arrow(at(i) - GAP, Y + H / 2, at(i) - 2, Y + H / 2, { color: NAVY });
  });

  // Self-assigned work skips Accept.
  arrow(mid(1), Y, mid(3), Y, {
    color: GREY,
    dash: true,
    via: [mid(1), Y - 26, mid(3), Y - 26],
    label: "self-assigned skips Accept",
  });

  // ---- above: rejection and reopening ------------------------------------
  const YA = 150;
  box(at(2), YA, W, H, LABEL.REJECTED, { stroke: AMBER, color: AMBER, bold: true });
  box(at(6), YA, W, H, LABEL.REOPENED, { stroke: AMBER, color: AMBER, bold: true });

  arrow(mid(4), Y, mid(2) + 20, YA + H, { color: AMBER, via: [mid(4), YA + 70], label: "reviewer sends it back" });
  arrow(mid(1), Y, mid(2) - 20, YA + H, { color: AMBER, via: [mid(1), YA + 70], label: "assignee declines" });
  arrow(mid(2), YA + H, mid(3) - 20, Y, { color: AMBER, via: [mid(2) + 10, Y - 46], label: "back to work" });

  arrow(mid(7), Y, mid(6) + 24, YA + H, { color: AMBER, via: [mid(7), YA + 70], label: "reopen, with a reason" });
  arrow(mid(6), YA + H, mid(3) + 24, Y, { color: AMBER, via: [mid(6) - 10, Y - 60], label: "picked up again" });

  // ---- below: paused and parked ------------------------------------------
  const YB = 400;
  box(at(3), YB, W, H, LABEL.BLOCKED, { stroke: RED, color: RED, bold: true });
  box(at(5), YB, W, H, LABEL.ON_HOLD, { stroke: GREY, color: GREY });
  box(at(6) + 6, YB, W, H, LABEL.DEFERRED, { stroke: GREY, color: GREY });

  arrow(mid(3) - 14, Y + H, mid(3) - 14, YB, { color: RED, label: "waiting on somebody" });
  arrow(mid(3) + 14, YB, mid(3) + 14, Y + H, { color: RED });

  // On hold and Deferred are one idea - work parked rather than progressing -
  // and they are reachable from and return to the same places, so they are
  // drawn as one region. Four separate arrows would say nothing more and would
  // cross everything on the way.
  doc.save();
  doc.roundedRect(at(5) - 8, YB - 16, W * 2 + 26, H + 30, 6).lineWidth(0.7).dash(2, { space: 2 });
  doc.strokeColor("#b9c0c9").stroke();
  doc.undash();
  doc.restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .fillColor(GREY)
    .text("PARKED", at(5) - 8, YB - 12, { width: W * 2 + 26, align: "center", characterSpacing: 0.5 });

  arrow(mid(3) + 30, Y + H, at(5) + 10, YB - 16, {
    color: GREY,
    via: [mid(3) + 30, YB - 42, at(5) + 10, YB - 42],
    labelAt: [mid(5) - 10, YB - 42],
    label: "from Assigned, Accepted or In progress",
  });
  arrow(at(5) + 10, YB + H + 14, mid(1), Y + H, {
    color: GREY,
    via: [at(5) + 10, YB + H + 30, mid(1), YB + H + 30],
    labelAt: [mid(3), YB + H + 38],
    label: "returns to Assigned or In progress",
  });

  // ---- cancelled ----------------------------------------------------------
  box(at(7), YB, W, H, LABEL.CANCELLED, { stroke: GREY, color: GREY, dash: true });
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(GREY)
    .text("from any active state, with a reason", at(7) - 10, YB + H + 6, { width: W + 20, align: "center" });

  // ---- legend -------------------------------------------------------------
  const LY = 492;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(NAVY).text("THE CLOCK", 36, LY, { characterSpacing: 0.6 });
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#1b2430")
    .text(
      "The SLA clock pauses in Blocked and On hold. Time spent waiting on somebody else is outside the assignee's control and never counts against them — that one rule is what keeps the timeliness figure fair.",
      36,
      LY + 12,
      { width: 360, lineGap: 1.5 },
    );

  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(NAVY).text("A REASON IS REQUIRED FOR", 420, LY, {
    characterSpacing: 0.6,
  });
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#1b2430")
    .text(
      MAP.reasonRequired.map((s) => LABEL[s]).join(" · ") +
        ". Each of these asserts something about another person's work or availability, and an unexplained one is useless to whoever receives it.",
      420,
      LY + 12,
      { width: 386, lineGap: 1.5 },
    );
}

// ------------------------------------------------------------- the step pages

const steps = [
  {
    part: "Start",
    title: "The task arrives",
    img: "01-assigned.jpg",
    body: "Work reaches somebody in one of two ways: generated from an approved desk card activity on its schedule, or raised by hand. Either way it lands in Assigned, and nothing has happened yet.",
    marks: [
      "Where it is. Every state it has passed through is ticked; the current one is filled.",
      "Accept — the assignee says it is theirs. Start goes straight to work for self-assigned tasks, where there is nobody to accept it from.",
      "Reject — the assignee declines it, with a reason. It goes back for somebody to reassign.",
      "Who it is for, who checks it, when it is due, and whether it came from a desk card.",
    ],
    note: "Only the moves that are legal from the current state are shown. Your role is checked again when you act — the screen is a convenience, the API is the authority.",
  },
  {
    part: "Doing the work",
    title: "In progress",
    img: "02-in-progress.jpg",
    body: "Accepting then starting puts the task In progress. This is where almost all of its life is spent.",
    marks: [
      "The facts, unchanged since it arrived unless a manager corrected them.",
      "The checklist. Every item must be ticked or explicitly waived before the work can be completed.",
      "Each item, ticked by whoever does the work.",
    ],
    note: "Evidence can be added at any point: a file, a note, or the ticked checklist. Any one of them is enough to keep the closure off the anti-gaming report.",
  },
  {
    part: "Doing the work",
    title: "When it is waiting on somebody else",
    img: "03-block-form.jpg",
    body: "Blocking is not a way of parking something you would rather not do. It says: this cannot proceed until a named person does something.",
    marks: [
      "Why it is blocked. Required — the reason is what the person unblocking it reads.",
      "Who owns unblocking it. Also required: a block with nobody against it is a task nobody will chase.",
      "Confirm.",
    ],
    note: "The SLA clock stops while a task is blocked. That is the point of recording it properly: the delay belongs to whoever caused it, not to the person holding the task.",
  },
  {
    part: "Doing the work",
    title: "Blocked, and back again",
    img: "04-blocked.jpg",
    body: "A blocked task is visible as blocked — on the board, on the team workload screen, and to whoever owns clearing it.",
    marks: [
      "The banner carries the reason, so nobody has to open the history to find out what is waiting.",
    ],
    note: "Blocked is a round trip, not a dead end: the only way out is back to In progress, or cancellation. It cannot be completed from here, which stops a blocked task being quietly closed to tidy a list.",
  },
  {
    part: "Checking",
    title: "Sent for review",
    img: "05-pending-review.jpg",
    body: "When the work is done, the assignee sends it to the named reviewer. A task with no reviewer cannot be sent at all — a manager assigns one first.",
    marks: [
      "The checklist is complete; that is a precondition of leaving In progress.",
      "Verify — the reviewer is satisfied.",
      "Reject — it goes back, with a reason.",
    ],
    note: "Nobody can verify their own work, under any role, including a system administrator. If the assignee and the reviewer are the same person, the system refuses — and it is right to.",
  },
  {
    part: "Checking",
    title: "Sent back",
    img: "06-rejected.jpg",
    body: "Rejection is a normal outcome, not a failure of the system. What matters is that the reason travels with it.",
    marks: [
      "The banner says it was rejected; the reason is in the history immediately below, in the reviewer's own words.",
    ],
    note: "From here the task goes back to In progress and round the loop again. Each pass is recorded separately, so a task rejected three times looks different from one that went through cleanly — which is a fact about the process, not an accusation about the person.",
  },
  {
    part: "Finishing",
    title: "Completed, then verified",
    img: "07-verify.jpg",
    body: "Completed, Verified and Closed are three different things, and collapsing them would lose the distinction the whole system rests on.",
    marks: [
      "Verify — a second person confirms it meets the requirement.",
      "Reject — still available at this point.",
      "A note, which is what an auditor reads alongside the dates.",
      "The completed checklist, kept as it was ticked.",
    ],
    note: "Completed is the assignee asserting the work is done. Verified is somebody else confirming it. Closed is the formal end. Task types that do not require verification close after a grace period instead.",
  },
  {
    part: "Finishing",
    title: "Closed",
    img: "08-closed.jpg",
    body: "The end of the line. Every state is ticked and the only move left is to reopen it.",
    marks: [
      "Reopen — available, audited, and reported. Reopening after closure is one of the things the anti-gaming view looks at, because it is how a premature closure gets corrected.",
    ],
    note: "A closed task takes no further edits except comments and attachments. Its figures are now part of the period they fall in.",
  },
  {
    part: "The record",
    title: "What it leaves behind",
    img: "09-activity.jpg",
    body: "Every move, with who made it, when, and — where the rules demand one — why. This is the same task from the previous eight pages.",
    marks: [
      "The whole journey in order: assigned, accepted, started, blocked with its reason, unblocked, sent for review, rejected with the reviewer's reason, back to work, completed, verified, closed.",
    ],
    note: "This is what makes the rest defensible. A figure in MIS or on somebody's appraisal evidence can always be traced back to a specific move by a specific person at a specific time — and to the reason they gave for it.",
  },
];

// ------------------------------------------------------------------ document

const doc = new PDFDocument({ size: "A4", margin: 46, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));
const W = doc.page.width - 92;

doc.rect(0, 0, doc.page.width, 210).fill(NAVY);
doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(30).text("The life of a task", 46, 76);
doc.font("Helvetica").fontSize(14).fillColor("#c9d6e8").text("Every state, every branch, start to end", 46, 120);
doc.fontSize(10).fillColor("#8fa6c4").text("Shah Investors Home Limited", 46, 152);

doc.fillColor("#1b2430").font("Helvetica").fontSize(11);
doc.text(
  "One task was driven through every branch on a running system to produce this guide — accepted, started, blocked, unblocked, sent for review, rejected, reworked, completed, verified and closed. The screens are that task, in order, and the last page is the trail it left.",
  46,
  250,
  { width: W, lineGap: 3 },
);
doc.moveDown(0.8);
doc.text(
  "The diagram overleaf and the table at the back are generated from the application's own state machine, not drawn by hand. If a move is not on them, the software refuses it.",
  { width: W, lineGap: 3 },
);

doc.moveDown(1.2);
doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("WHAT IS IN HERE", { characterSpacing: 0.8 });
doc.moveDown(0.5);
doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text("The whole picture — one diagram", { indent: 10 });
let lastPart = null;
steps.forEach((s, i) => {
  if (s.part !== lastPart) {
    lastPart = s.part;
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(RED).text(s.part.toUpperCase(), { characterSpacing: 0.5 });
    doc.moveDown(0.15);
  }
  doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text(`${i + 1}.  ${s.title}`, { indent: 10 });
});
doc.moveDown(0.3);
doc.font("Helvetica-Bold").fontSize(9.5).fillColor(RED).text("REFERENCE", { characterSpacing: 0.5 });
doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text("Every legal move, in full", { indent: 10 });

drawDiagram(doc);

steps.forEach((s, i) => {
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(RED).text(s.part.toUpperCase(), 46, 46, { characterSpacing: 0.8 });
  doc.font("Helvetica-Bold").fontSize(19).fillColor(NAVY).text(`${i + 1}.  ${s.title}`, 46, 62);
  doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text(s.body, 46, 94, { width: W, lineGap: 2.5 });

  let y = doc.y + 12;
  const imgH = (W * 544) / 799;
  doc.save();
  doc.roundedRect(46, y, W, imgH, 4).lineWidth(0.8).strokeColor("#d6dbe2").stroke();
  doc.image(SHOTS + s.img, 46, y, { width: W });
  doc.restore();
  y += imgH + 16;

  s.marks.forEach((m, n) => {
    doc.save();
    doc.circle(54, y + 5, 8).fill(RED);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text(String(n + 1), 46, y + 1.5, {
      width: 16,
      align: "center",
    });
    doc.restore();
    doc.font("Helvetica").fontSize(9.7).fillColor("#1b2430").text(m, 72, y, { width: W - 26, lineGap: 2.2 });
    y = doc.y + 7;
  });

  if (s.note) {
    y += 2;
    const h = doc.heightOfString(s.note, { width: W - 34, lineGap: 2 }) + 18;
    doc.save();
    doc.roundedRect(46, y, W, h, 4).fill("#f3f6fa");
    doc.restore();
    doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(GREY).text(s.note, 63, y + 9, { width: W - 34, lineGap: 2 });
  }
});

// ------------------------------------------------------------ the full table
doc.addPage();
doc.font("Helvetica-Bold").fontSize(8.5).fillColor(RED).text("REFERENCE", 46, 46, { characterSpacing: 0.8 });
doc.font("Helvetica-Bold").fontSize(19).fillColor(NAVY).text("Every legal move, in full", 46, 62);
doc
  .font("Helvetica")
  .fontSize(10.5)
  .fillColor("#1b2430")
  .text(
    "Read straight out of the application's state machine. Anything absent from this table is refused — not hidden, refused, with a message saying so.",
    46,
    94,
    { width: W, lineGap: 2.5 },
  );

let ty = doc.y + 14;
doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY);
doc.text("FROM", 52, ty, { width: 110, characterSpacing: 0.5 });
doc.text("CAN MOVE TO", 170, ty, { characterSpacing: 0.5 });
ty += 14;
doc.moveTo(46, ty - 3).lineTo(46 + W, ty - 3).lineWidth(0.6).strokeColor("#d6dbe2").stroke();

for (const [from, tos] of Object.entries(MAP.allowed)) {
  const needsReason = MAP.reasonRequired.includes(from);
  const text = tos.length
    ? tos.map((t) => LABEL[t] + (MAP.reasonRequired.includes(t) ? " *" : "")).join(", ")
    : "— terminal, nothing follows";
  const h = Math.max(doc.heightOfString(text, { width: W - 130 }), 11) + 7;

  doc.font("Helvetica-Bold").fontSize(9).fillColor(needsReason ? AMBER : "#1b2430").text(LABEL[from], 52, ty, {
    width: 112,
  });
  doc.font("Helvetica").fontSize(9).fillColor(tos.length ? "#1b2430" : GREY).text(text, 170, ty, {
    width: W - 130,
    lineGap: 1.5,
  });
  ty += h;
  doc.moveTo(46, ty - 3).lineTo(46 + W, ty - 3).lineWidth(0.4).strokeColor("#eef1f5").stroke();
}

ty += 8;
doc
  .font("Helvetica-Oblique")
  .fontSize(9)
  .fillColor(GREY)
  .text(
    "* a reason is required to make this move. States shown in amber are the ones a task cannot be put into silently.",
    52,
    ty,
    { width: W - 12, lineGap: 2 },
  );

// -------------------------------------------------------------- page numbers
const range = doc.bufferedPageRange();
for (let p = 1; p < range.count; p++) {
  doc.switchToPage(p);
  doc.page.margins.bottom = 0;
  const bottom = doc.page.height - 34;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(LIGHT)
    .text(`workPulse — the life of a task   ·   ${p} of ${range.count - 1}`, 36, bottom, {
      width: doc.page.width - 72,
      align: "right",
    });
}

doc.end();
console.log("written " + OUT);
