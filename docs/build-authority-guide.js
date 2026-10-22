/**
 * Builds the authority matrix: every action in workPulse, who may take it, and
 * where it is done.
 *
 * The rows come from docs/authority.json, which is read out of the API's own
 * router by export-authority.js. Nothing in this table is typed from memory,
 * because the question that prompted it - "can a manager create a desk card?" -
 * had an answer in the code (no) that contradicted a guide written by hand.
 *
 * Rebuild with: npm run docs:authority
 */
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "authority.json"), "utf8"));
const OUT = path.join(__dirname, "workPulse-who-can-do-what.pdf");

const NAVY = "#0f2d52";
const RED = "#e11d48";
const GREY = "#5b6472";
const LIGHT = "#9aa3ae";
const RULE = "#d6dbe2";

/** Short, readable names. The enum names are shouty and column space is tight. */
const ROLE_LABEL = {
  SYSTEM_ADMIN: "Admin",
  DEPARTMENT_HEAD: "Dept head",
  MANAGER: "Manager",
  PROJECT_MANAGER: "Project mgr",
  EXECUTIVE: "Exec",
  EXECUTIVE_RESTRICTED: "Exec (restricted)",
  AUDIT: "Audit",
  EMPLOYEE: "Employee",
  INTEGRATION_SERVICE: "Integration",
  ANY_SIGNED_IN: "Anyone signed in",
  PUBLIC: "No sign-in needed",
};

/**
 * Areas in the order a reader looks for them, not the order the router
 * declares them. Anything not listed is dropped: ping and reference lookups
 * are plumbing, and a matrix padded with plumbing stops being read.
 */
const AREAS = [
  { key: "deskCard", title: "Desk cards", where: "Desk cards" },
  { key: "activity", title: "Activities on a desk card", where: "Desk cards → the card" },
  { key: "workflow", title: "Written procedures", where: "Desk cards → the card → Steps" },
  { key: "task", title: "Tasks", where: "My tasks" },
  { key: "handover", title: "Handover", where: "Handover" },
  { key: "project", title: "Projects", where: "Projects" },
  { key: "sla", title: "SLA targets", where: "SLA targets" },
  { key: "taskType", title: "Task types", where: "Task types" },
  { key: "orgMaster", title: "Designations and branches", where: "Designations & branches" },
  { key: "governance", title: "Policies and processes", where: "Policies & processes" },
  { key: "access", title: "Access and roles", where: "Access" },
  { key: "sourceSystem", title: "Source systems", where: "Access" },
  { key: "calendar", title: "Calendar and capacity", where: "Calendar" },
  { key: "flag", title: "Flags", where: "Flags" },
  { key: "appraisal", title: "Appraisal evidence", where: "Appraisal evidence" },
  { key: "analytics", title: "Performance", where: "My performance / Team" },
  { key: "mis", title: "MIS", where: "MIS" },
  { key: "shadowScore", title: "Shadow quarter", where: "Shadow quarter (URL only)" },
  { key: "commandCentre", title: "Command Centre", where: "Command Centre" },
  { key: "prediction", title: "At risk", where: "At risk" },
  { key: "employee", title: "Employee directory", where: "Employees" },
];

/**
 * Plain-English names for the actions somebody will actually look up, and
 * where each is done when it differs from the area's usual screen.
 *
 * Anything absent falls back to a humanised procedure name, which is honest
 * about being derived rather than written - better a slightly clumsy label
 * than a confident wrong one.
 */
const LABELS = {
  "deskCard.create": ["Create a desk card", "Desk cards → New desk card"],
  "deskCard.update": ["Correct a card's name, description or department", "The card → Edit"],
  "deskCard.setStatus": ["Approve or retire a card", "The card"],
  "deskCard.transferHolder": ["Give a card to somebody else", "The card → Transfer"],
  "deskCard.acknowledge": ["Acknowledge the card you have been given", "My desk card"],
  "deskCard.mine": ["See your own card", "My desk card"],
  "deskCard.list": ["See all desk cards", "Desk cards"],

  "activity.create": ["Add an obligation to a card", "The card → Add activity"],
  "activity.amend": ["Change an obligation", "The card → Edit on the row"],
  "activity.amendEstimatedMinutes": ["Change how long it should take", "The card → Edit on the row"],
  "activity.setStatus": ["Approve an obligation so it generates work", "The card"],
  "activity.setPaused": ["Pause or resume an obligation", "The card"],
  "activity.setActive": ["Retire or restore an obligation", "The card"],

  "workflow.createDraft": ["Write the steps a procedure follows", "The card → Steps"],
  "workflow.editDraft": ["Change a draft procedure", "The card → Steps → Edit draft"],
  "workflow.approve": ["Approve a procedure (never your own)", "The card → Steps → Approve"],
  "workflow.forActivity": ["Read the procedure for an obligation", "The card → Steps"],
  "workflow.current": ["Read the procedure in force", "The task"],

  "task.create": ["Raise a one-off task", "My tasks → New task"],
  "task.transition": ["Accept, start, block, complete, verify, close", "The task"],
  "task.reassign": ["Move a task to somebody else", "The task → Manage"],
  "task.update": ["Correct due date, priority or reviewer", "The task → Manage"],
  "task.setChecklistItem": ["Tick a checklist item", "The task"],
  "task.addComment": ["Add a note", "The task"],
  "task.attachments": ["See the evidence on a task", "The task"],
  "task.removeAttachment": ["Withdraw an attachment", "The task"],
  "task.mine": ["See your own work", "My tasks"],

  "taskType.create": ["Add a task type", "Task types → New type"],
  "taskType.update": ["Change what a task type requires (removing a control asks why)", "Task types"],
  "taskType.setActive": ["Retire a task type, or bring one back", "Task types"],

  "orgMaster.rename": ["Rename a designation or branch everywhere at once", "Designations & branches"],
  "orgMaster.merge": ["Merge two into one, moving the people", "Designations & branches"],
  "orgMaster.markReviewed": ["Accept a designation or branch as it stands", "Designations & branches"],
  "orgMaster.setActive": ["Retire a designation or branch", "Designations & branches"],

  "employee.syncFromSynapse": ["Pull staff and departments from Synapse now", "Employees"],

  "sla.createDefinition": ["Set an SLA target", "SLA targets"],
  "sla.updateDefinition": ["Change a target (extending asks why)", "SLA targets"],
  "sla.addEscalationRule": ["Add an escalation level", "SLA targets"],
  "sla.removeEscalationRule": ["Remove an escalation level", "SLA targets"],

  "governance.createPolicy": ["Create a policy", "Policies & processes"],
  "governance.createProcess": ["Create a process", "Policies & processes"],
  "governance.setActivityProcess": ["Say which control an obligation serves", "The card → Serves"],
  "governance.generateManual": ["Generate a department manual", "Policies & processes"],
  "governance.orphans": ["Find obligations serving no control", "Policies & processes"],

  "access.upsertMapping": ["Map a Synapse role to a workPulse role", "Access"],
  "access.deactivateMapping": ["Stop a Synapse role granting access", "Access"],
  "access.grant": ["Grant a role to one person directly", "Access"],
  "access.revoke": ["Take a direct grant away", "Access"],
  "access.setMenu": ["Give somebody a shorter menu", "Access"],
  "access.coverage": ["See which roles nobody can reach", "Access"],

  "project.create": ["Start a project", "Projects → New project"],
  "project.assignRaci": ["Say who is responsible, accountable, consulted, informed", "The project"],
  "project.createDecision": ["Record a decision that needs an approver", "The project"],
  "project.decide": ["Close a decision (named approver only)", "The project"],
  "project.raiseRisk": ["Raise a risk", "The project"],
  "project.overrideHealth": ["Override the calculated health", "The project"],
  "project.attachTask": ["Attach an existing task to a project", "The project"],

  "handover.build": ["Build a handover pack", "Handover"],
  "handover.approve": ["Approve a handover", "Handover"],
  "handover.complete": ["Complete a handover", "Handover"],

  "flag.review": ["Review a flagged pattern", "Flags"],
  "shadowScore.report": ["Read the shadow quarter", "Shadow quarter"],
  "analytics.recompute": ["Recompute performance for a period", "My performance"],
};

/** camelCase -> "Camel case", for anything not named above. */
function humanise(proc) {
  const words = proc.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function rolesFor(entry) {
  if (entry.roles.length === 1 && ROLE_LABEL[entry.roles[0]]) return ROLE_LABEL[entry.roles[0]];
  // Admin is on almost every governance row; saying so each time wastes the
  // column without informing anybody.
  const named = entry.roles.filter((r) => r !== "SYSTEM_ADMIN").map((r) => ROLE_LABEL[r] ?? r);
  if (named.length === 0) return "Admin";
  return named.join(", ") + ", Admin";
}

const doc = new PDFDocument({ size: "A4", margin: 46, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));
const W = doc.page.width - 92;

// ---------------------------------------------------------------- cover ----
doc.font("Helvetica-Bold").fontSize(26).fillColor(NAVY).text("Who can do what", 46, 70);
doc.font("Helvetica").fontSize(13).fillColor(GREY).text("Every action in workPulse, who may take it, and where", 46, 104);

doc.moveDown(2);
doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text(
  "This table is generated by reading the application's own permission rules. If a row here disagrees with something you were told, this row is right — and the guide that disagrees needs correcting.",
  46, 150, { width: W, lineGap: 3 },
);

doc.moveDown(1);
doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text(
  "Two distinctions do most of the work. Seeing something and changing it are different permissions, so each row says which it is. And a manager is not a department head: a manager runs the work, while a department head defines what the work is. That line is deliberate — if a manager could rewrite their own team's obligations, the record would be worth much less to an auditor, and an obligation a team kept failing could quietly disappear.",
  { width: W, lineGap: 3 },
);

doc.moveDown(1);
doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("THE ROLES", { characterSpacing: 0.8 });
doc.moveDown(0.4);
for (const [name, list] of Object.entries(DATA.roleConstants)) {
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(RED).text(name.replace(/_/g, " ").toLowerCase() + ":", { continued: true });
  doc.font("Helvetica").fontSize(9.5).fillColor("#1b2430").text(" " + list.map((r) => ROLE_LABEL[r] ?? r).join(", "));
}

doc.moveDown(1.2);
doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT).text(
  `Generated from apps/api/src/trpc/trpc.service.ts. ${Object.values(DATA.routers).reduce((n, r) => n + Object.keys(r).length, 0)} actions in all; the plumbing ones are left out.`,
  { width: W },
);

// --------------------------------------------------------------- tables ----
const COL_ACTION = 46;
const COL_WHO = 46 + W * 0.42;
const COL_HOW = 46 + W * 0.72;

function header(title) {
  doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY).text("ACTION", COL_ACTION, doc.y, { characterSpacing: 0.6, continued: false });
  const y = doc.y - 10;
  doc.text("WHO", COL_WHO, y, { characterSpacing: 0.6 });
  doc.text("WHERE", COL_HOW, y, { characterSpacing: 0.6 });
  doc.moveTo(46, doc.y + 2).lineTo(46 + W, doc.y + 2).lineWidth(0.8).strokeColor(RULE).stroke();
  doc.moveDown(0.6);
}

for (const area of AREAS) {
  const procs = DATA.routers[area.key];
  if (!procs) continue;

  const rows = Object.entries(procs).map(([proc, entry]) => {
    const key = `${area.key}.${proc}`;
    const [label, where] = LABELS[key] ?? [humanise(proc), area.where];
    return { label, where, who: rolesFor(entry), kind: entry.kind };
  });
  // Changes first: they are what people look up.
  rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "change" ? -1 : 1));

  const needed = 46 + rows.length * 17;
  if (doc.y + needed > doc.page.height - 60) doc.addPage();
  else doc.moveDown(1.4);

  doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY).text(area.title, 46, doc.y);
  doc.moveDown(0.5);
  header();

  for (const row of rows) {
    if (doc.y > doc.page.height - 70) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY).text(area.title + " (continued)", 46, doc.y);
      doc.moveDown(0.5);
      header();
    }
    const y = doc.y;
    // A small square says change or view without a column of its own.
    doc.save();
    doc.rect(46, y + 3, 4, 4).fill(row.kind === "change" ? RED : "#c4cad2");
    doc.restore();

    // Each column is drawn from the same top, so the row is as tall as its
    // tallest cell. Taking only the last column's end lets a wrapped role list
    // be overwritten by the next row, which is how the first build looked.
    doc.font("Helvetica").fontSize(9).fillColor("#1b2430")
      .text(row.label, COL_ACTION + 10, y, { width: W * 0.42 - 14 });
    const endAction = doc.y;

    doc.font("Helvetica").fontSize(9).fillColor(row.who.includes("Anyone") ? GREY : "#1b2430")
      .text(row.who, COL_WHO, y, { width: W * 0.3 - 8 });
    const endWho = doc.y;

    doc.font("Helvetica").fontSize(8.5).fillColor(GREY)
      .text(row.where, COL_HOW, y, { width: W * 0.28 });
    const endWhere = doc.y;

    doc.y = Math.max(endAction, endWho, endWhere) + 3;
  }
}

// ---------------------------------------------------------------- legend ---
doc.moveDown(1.2);
if (doc.y > doc.page.height - 120) doc.addPage();
doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("READING THIS", 46, doc.y, { characterSpacing: 0.8 });
doc.moveDown(0.4);
doc.save();
doc.rect(46, doc.y + 3, 4, 4).fill(RED);
doc.restore();
doc.font("Helvetica").fontSize(9).fillColor("#1b2430").text("changes something", 56, doc.y, { width: W - 20 });
doc.save();
doc.rect(46, doc.y + 3, 4, 4).fill("#c4cad2");
doc.restore();
doc.font("Helvetica").fontSize(9).fillColor("#1b2430").text("only shows something", 56, doc.y, { width: W - 20 });
doc.moveDown(0.6);
doc.font("Helvetica").fontSize(9).fillColor(GREY).text(
  "“Anyone signed in” still means what each person is allowed to see: your own tasks are yours, not everybody's. The role gate is the outer door, not the only one — a named approver, a reviewer who did not do the work, and a procedure nobody approved alone are all checked separately, and none of them appears in this table.",
  46, doc.y, { width: W, lineGap: 2.5 },
);

const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(i);
  doc.font("Helvetica").fontSize(8).fillColor(LIGHT)
    .text(`workPulse — who can do what   ·   page ${i + 1} of ${range.count}`, 46, doc.page.height - 38, { width: W, align: "center" });
}

doc.end();
console.log("written", OUT);
