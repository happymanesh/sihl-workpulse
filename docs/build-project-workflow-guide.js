/**
 * Builds the project workflow guide: a project from raised to closed, with a
 * matrix of which role may do what.
 *
 * The status diagram, the health thresholds and the role matrix all come from
 * the application rather than from memory — the matrix is exported to
 * docs/project-roles.json by reading the API's own router. Regenerate it with
 * npm run docs:project-roles when a procedure's roles change.
 */
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const SHOTS = path.join(__dirname, "guide-images-pm") + path.sep;
const OUT = path.join(__dirname, "workPulse-project-workflow.pdf");
const ROLES = JSON.parse(fs.readFileSync(path.join(__dirname, "project-roles.json"), "utf8"));

const NAVY = "#0f2d52";
const RED = "#e11d48";
const GREY = "#5b6472";
const LIGHT = "#9aa3ae";
const AMBER = "#b45309";
const GREEN = "#15803d";

const ROLE_LABEL = {
  SYSTEM_ADMIN: "System admin",
  DEPARTMENT_HEAD: "Dept head",
  PROJECT_MANAGER: "Project mgr",
  MANAGER: "Manager",
  EXECUTIVE: "Executive",
  EXECUTIVE_RESTRICTED: "Exec (restricted)",
  AUDIT: "Audit",
  EMPLOYEE: "Employee",
  ANY: "Anyone signed in",
};

/** Procedure name -> what a person would call it. Only what the guide covers. */
const ACTIVITY = [
  ["Open the project register", "list", null],
  ["Open a project", "byId", null],
  ["Start a project", "create", null],
  ["Move it through planning, active, on hold, completed", "setStatus", null],
  ["Recalculate the health figure", "recalculateHealth", "Read-only — it only recomputes from existing facts"],
  ["Override the health figure", "overrideHealth", "A reason is required and the override is always shown as one"],
  ["Add a milestone", "addMilestone", null],
  ["Report a milestone met, or re-open it", "setMilestoneComplete", null],
  ["Delete a milestone", "removeMilestone", "Refused once it has been reported met"],
  ["Raise a risk or issue", "raiseRisk", null],
  ["Escalate it to blocking, or stand it down", "setRiskBlocking", "A reason is required"],
  ["Resolve it", "resolveRisk", "A note saying how is required"],
  ["Put a task into the project", "attachTask", null],
  ["Take a task back out", "detachTask", "A reason is required"],
  ["Set or change RACI", "assignRaci", "Exactly one Accountable; replacing them is explicit"],
  ["Remove a RACI assignment", "removeRaci", null],
  ["Raise a decision", "createDecision", "Exactly one named Approver"],
  ["Close a decision", "decide", "ONLY the named Approver — see page 8"],
  ["Link one task to another", "addDependency", "Cycles are refused"],
];

// ---------------------------------------------------------------- the diagram

function drawDiagram(doc) {
  doc.addPage({ size: "A4", layout: "landscape", margin: 36 });

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(RED).text("THE WHOLE PICTURE", 36, 34, {
    characterSpacing: 0.8,
  });
  doc.font("Helvetica-Bold").fontSize(17).fillColor(NAVY).text("A project, and the light that reports it", 36, 48);
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#1b2430")
    .text(
      "A project moves through four states. What makes it different from a list of tasks is the traffic light underneath: it is computed from three facts about the work, not typed in by whoever writes the status report.",
      36,
      72,
      { width: 520, lineGap: 2 },
    );

  const box = (x, y, w, h, text, o = {}) => {
    const { fill = "#ffffff", stroke = "#9aa3ae", color = "#1b2430", bold = false, dash = false, size = 8.5 } = o;
    doc.save();
    doc.roundedRect(x, y, w, h, 5);
    if (dash) doc.dash(2, { space: 2 });
    doc.lineWidth(bold ? 1.4 : 0.9).fillAndStroke(fill, stroke);
    doc.undash();
    doc.restore();
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(size)
      .fillColor(color)
      .text(text, x, y + h / 2 - size * 0.6, { width: w, align: "center" });
  };

  const arrow = (x1, y1, x2, y2, o = {}) => {
    const { color = "#6b7480", label, via, labelAt, dash = false } = o;
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
      doc.font("Helvetica").fontSize(6.5).fillColor(color).text(label, mx - 40, my - 9, {
        width: 80,
        align: "center",
      });
    }
  };

  // ---- status spine -------------------------------------------------------
  const W = 110;
  const H = 36;
  const Y = 150;
  const xs = [60, 240, 420, 600];
  const names = ["Planning", "Active", "Completed", "Cancelled"];
  names.forEach((n, i) => {
    box(xs[i], Y, W, H, n, {
      bold: true,
      stroke: i === 3 ? GREY : NAVY,
      color: i === 3 ? GREY : NAVY,
      dash: i === 3,
      fill: i === 2 ? "#eef2f7" : "#ffffff",
    });
  });
  arrow(xs[0] + W, Y + H / 2, xs[1] - 2, Y + H / 2, { color: NAVY, label: "work starts" });
  arrow(xs[1] + W, Y + H / 2, xs[2] - 2, Y + H / 2, { color: NAVY, label: "everything done" });
  arrow(xs[2] + W, Y + H / 2, xs[3] - 2, Y + H / 2, { color: GREY, dash: true, label: "or abandoned, with a reason" });

  box(xs[1], Y + 86, W, H, "On hold", { stroke: GREY, color: GREY });
  arrow(xs[1] + 30, Y + H, xs[1] + 30, Y + 86, { color: GREY });
  arrow(xs[1] + 80, Y + 86, xs[1] + 80, Y + H, { color: GREY, label: "resumed" });

  // The completion gate.
  doc.save();
  doc.roundedRect(xs[2] - 24, Y - 54, 158, 40, 5).lineWidth(0.8).dash(2, { space: 2 }).strokeColor(RED).stroke();
  doc.undash();
  doc.restore();
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(RED)
    .text(
      "Refused while any task is still open\nor any blocking issue is unresolved.\nThe refusal names what is outstanding.",
      xs[2] - 24,
      Y - 48,
      { width: 158, align: "center", lineGap: 1 },
    );

  // ---- the health calculation --------------------------------------------
  const HY = 330;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(RED).text("HOW THE LIGHT IS DECIDED", 36, HY - 24, {
    characterSpacing: 0.8,
  });

  const inputs = [
    ["Missed milestones", "any at all", RED],
    ["Unresolved blocking issues", "1 = amber · 2+ = red", AMBER],
    ["Overdue tasks in the project", ">15% = amber · >30% = red", AMBER],
  ];
  inputs.forEach((inp, i) => {
    const x = 60 + i * 200;
    box(x, HY, 170, 42, "", { stroke: inp[2] });
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#1b2430").text(inp[0], x, HY + 9, {
      width: 170,
      align: "center",
    });
    doc.font("Helvetica").fontSize(7).fillColor(inp[2]).text(inp[1], x, HY + 24, { width: 170, align: "center" });
    arrow(x + 85, HY + 42, 500, HY + 92, { color: "#b9c0c9", via: [x + 85, HY + 70, 500, HY + 70] });
  });

  box(440, HY + 92, 120, 36, "Green / Amber / Red", { bold: true, stroke: NAVY, color: NAVY, size: 8 });
  box(610, HY + 92, 150, 36, "Override, with a reason", { stroke: AMBER, color: AMBER, dash: true, size: 8 });
  arrow(560, HY + 110, 608, HY + 110, { color: AMBER });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#1b2430")
    .text(
      "A missed milestone turns a project red on its own, whatever the task arithmetic says — a date that was promised and passed is not offset by a tidy percentage. A project manager may override the computed value, but the override is always shown as an override, with the reason and the figure it replaced beside it.",
      60,
      HY + 146,
      { width: 700, lineGap: 2 },
    );
}

// ------------------------------------------------------------- the step pages

const steps = [
  {
    part: "Setting up",
    title: "The register",
    img: "01-projects-list.jpg",
    body: "Every project in one list, with the column that matters on the right. A project is a bounded body of cross-functional work with its own accountability — as opposed to a desk card, which is the standing duties of a seat and never finishes.",
    marks: [
      "Start one. Project manager or above.",
      "The register. Health here is computed, not reported — which is why it can disagree with the person running the project.",
    ],
  },
  {
    part: "Setting up",
    title: "Starting one",
    img: "02-new-project.jpg",
    body: "Three people are asked for separately because they are three different jobs. One person may hold more than one, but the form does not assume it.",
    marks: [
      "A short code you can quote in a steering pack.",
      "What it is called.",
      "Owner — carries the outcome.",
      "Project manager — runs it day to day.",
      "Sponsor — clears the way. Optional, and usually the answer to “who do I escalate to”.",
      "Creates it in planning, where it reports nothing until there is something in it.",
    ],
  },
  {
    part: "Setting up",
    title: "Who answers for it, and what is due",
    img: "04-raci-milestones.jpg",
    body: "RACI on the left, milestones on the right. Both feed how the project reports itself, and both are where a project quietly goes wrong if nobody fills them in.",
    marks: [
      "Add somebody and give them a role. Exactly one person is Accountable at a time; assigning a second asks you to confirm the replacement rather than displacing them silently.",
      "Assign.",
      "Tick a milestone to report it met — the date it was met is recorded, not just the fact.",
      "Delete one that was never real. One already reported met cannot be deleted; re-open it first if that was wrong.",
      "Add a milestone: a name and the date it is committed for.",
    ],
    note: "A project with no milestones reads green however late it is. That is not a flaw in the light — it is the absence of anything to measure against.",
  },
  {
    part: "Running it",
    title: "The work that counts towards it",
    img: "08-project-tasks.jpg",
    body: "Tasks are not created inside a project. They are ordinary tasks — somebody's work, with the same lifecycle, reviewer and evidence rules — and the project link says which body of work they count towards.",
    marks: [
      "Add a task. Only tasks not already in a project are offered: a task counts towards one project, or none.",
      "The project's work, with dependencies, owner, priority and status.",
      "Take one out, with a reason — the project's figures change when it leaves.",
    ],
    note: "This is where “33% of tasks are overdue” comes from. Each task still runs the full lifecycle of its own, covered in the companion guide.",
  },
  {
    part: "Running it",
    title: "Risks, issues and decisions",
    img: "05-risks-decisions.jpg",
    body: "Two different things, deliberately kept apart. A risk is something that could go wrong and is somebody's job to chase. A decision is a question that needs an answer from a named person.",
    marks: [
      "Raise a risk. Tick blocking if the project genuinely cannot finish until it is resolved.",
      "Stand it down or escalate it — always with a reason, because blocking stops the project closing.",
      "Resolve it. You are asked how, not just that.",
      "Decide an open decision.",
    ],
  },
  {
    part: "Running it",
    title: "A decision has exactly one Approver",
    img: "06-decide.jpg",
    body: "Decisions use DACI: a Driver who does the work of deciding, and an Approver who signs it off. The sign-off is the part that is enforced.",
    marks: [
      "What was decided, and why — recorded with the decision, so the reasoning survives the meeting.",
      "Approve.",
      "Reject — also recorded, with the reasoning.",
    ],
    note: "The screen names who may do it. The button is offered to everybody because a clear refusal teaches the rule better than a greyed-out control with no explanation.",
  },
  {
    part: "Running it",
    title: "Not even an administrator",
    img: "07-approver-only.jpg",
    body: "This is a system administrator — the most privileged role there is — being refused a decision sign-off.",
    marks: [
      "“Sign-off cannot be delegated, escalated or overridden.” Not by the Driver who did the work, not by a manager, not by an administrator.",
    ],
    note: "A decision closed by the wrong person is not a decision; it is somebody else's opinion wearing its clothes. If the Approver is unavailable, change the Approver — and that change is itself recorded.",
  },
  {
    part: "Reporting",
    title: "Reading the project",
    img: "03-project-overview.jpg",
    body: "The top of the screen answers the four questions a steering meeting opens with, and then explains its own traffic light.",
    marks: [
      "Owner, sponsor, manager, status.",
      "Why this health, in plain words. A light nobody can interrogate gets argued with; one that explains itself gets acted on.",
      "Recalculate, if you have just changed something and want the figure now.",
    ],
    note: "Health is recomputed automatically whenever a milestone, risk or task changes. The button is for impatience, not correctness.",
  },
  {
    part: "Reporting",
    title: "Status, and disagreeing with the figure",
    img: "09-status-health.jpg",
    body: "Moving a project between states is a recorded act with a reason, and completion is refused while anything is outstanding.",
    marks: [
      "The status.",
      "Why it is moving.",
      "Apply it.",
      "Override the health if you genuinely disagree with the calculation.",
      "Why you disagree — required, and shown wherever the override is.",
    ],
  },
];

// ------------------------------------------------------------------ document

const doc = new PDFDocument({ size: "A4", margin: 46, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));
const W = doc.page.width - 92;

doc.rect(0, 0, doc.page.width, 210).fill(NAVY);
doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(30).text("Running a project", 46, 76);
doc.font("Helvetica").fontSize(14).fillColor("#c9d6e8").text("The workflow, step by step — and who may do what", 46, 120);
doc.fontSize(10).fillColor("#8fa6c4").text("Shah Investors Home Limited", 46, 152);

doc.fillColor("#1b2430").font("Helvetica").fontSize(11);
doc.text(
  "A project in workPulse is governance, not scheduling. It records who answers for the work, what was committed, what could stop it, what has been decided and by whom — and reports its own health from those facts rather than from a status update somebody typed.",
  46,
  250,
  { width: W, lineGap: 3 },
);
doc.moveDown(0.8);
doc.text(
  "The final section lists every action on a project against the roles permitted to take it. It is generated by reading the application's own API, so it cannot drift from what is enforced.",
  { width: W, lineGap: 3 },
);

doc.moveDown(1.1);
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
doc.font("Helvetica-Bold").fontSize(9.5).fillColor(RED).text("WHO MAY DO WHAT", { characterSpacing: 0.5 });
doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text("Every action, against the roles that may take it", {
  indent: 10,
});

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
    doc.font("Helvetica").fontSize(9.5).fillColor("#1b2430").text(m, 72, y, { width: W - 26, lineGap: 2.2 });
    y = doc.y + 6.5;
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

// -------------------------------------------------------- who may do what
doc.addPage();
doc.font("Helvetica-Bold").fontSize(8.5).fillColor(RED).text("WHO MAY DO WHAT", 46, 46, { characterSpacing: 0.8 });
doc.font("Helvetica-Bold").fontSize(19).fillColor(NAVY).text("Every action, against the roles", 46, 62);
doc
  .font("Helvetica")
  .fontSize(10.5)
  .fillColor("#1b2430")
  .text(
    "Read out of the application's own API. Anybody signed in can look at a project; changing one needs a role. Where a rule is stricter than the role gate, it is noted — the gate decides who may attempt the action, the rule decides whether it succeeds.",
    46,
    94,
    { width: W, lineGap: 2.5 },
  );

let ty = doc.y + 14;
doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY);
doc.text("ACTION", 52, ty, { width: 210, characterSpacing: 0.5 });
doc.text("ROLES", 272, ty, { characterSpacing: 0.5 });
ty += 13;
doc.moveTo(46, ty - 3).lineTo(46 + W, ty - 3).lineWidth(0.6).strokeColor("#d6dbe2").stroke();

for (const [label, proc, note] of ACTIVITY) {
  const roles = ROLES[proc] ?? ["ANY"];
  const open = roles.length === 1 && roles[0] === "ANY";
  const rolesText = open ? "Anyone signed in" : roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ");

  const hLabel = doc.heightOfString(label, { width: 206 });
  const hRoles = doc.heightOfString(rolesText, { width: W - 236 });
  const hNote = note ? doc.heightOfString(note, { width: W - 236 }) + 2 : 0;
  const h = Math.max(hLabel, hRoles + hNote) + 8;

  doc.font("Helvetica").fontSize(9).fillColor("#1b2430").text(label, 52, ty, { width: 206 });
  doc
    .font(open ? "Helvetica" : "Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(open ? GREY : NAVY)
    .text(rolesText, 272, ty, { width: W - 236 });
  if (note) {
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(AMBER).text(note, 272, doc.y + 1, { width: W - 236 });
  }
  ty += h;
  doc.moveTo(46, ty - 3).lineTo(46 + W, ty - 3).lineWidth(0.4).strokeColor("#eef1f5").stroke();
}

ty += 8;
doc
  .font("Helvetica-Oblique")
  .fontSize(9)
  .fillColor(GREY)
  .text(
    "Reading a project is open to everybody signed in, deliberately: a project nobody outside it can see is a project nobody can hold to account. Audit and the executive roles read everything; they change nothing here.",
    52,
    ty,
    { width: W - 12, lineGap: 2 },
  );

// -------------------------------------------------------------- page numbers
const range = doc.bufferedPageRange();
for (let p = 1; p < range.count; p++) {
  doc.switchToPage(p);
  doc.page.margins.bottom = 0;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(LIGHT)
    .text(`workPulse — running a project   ·   ${p} of ${range.count - 1}`, 36, doc.page.height - 34, {
      width: doc.page.width - 72,
      align: "right",
    });
}

doc.end();
console.log("written " + OUT);
