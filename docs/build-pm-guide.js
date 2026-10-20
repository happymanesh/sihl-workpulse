/**
 * Builds the project guide for the technology and project management team.
 *
 * Same shape as build-user-guide.js: the screenshots carry numbered markers
 * drawn on the page before capture, so the numbers in the picture and the
 * numbers in the text are the same thing. A page may have no image, which is
 * how the closing "what is not here" page is set.
 */
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { frameHeight } = require("./image-size");

const SHOTS = path.join(__dirname, "guide-images-pm") + path.sep;
const OUT = path.join(__dirname, "workPulse-project-guide.pdf");

const NAVY = "#0f2d52";
const RED = "#e11d48";
const GREY = "#5b6472";
const LIGHT = "#9aa3ae";

const steps = [
  {
    part: "Running a project",
    title: "What a project is here",
    img: "01-projects-list.jpg",
    body: "A project is a bounded body of cross-functional work with its own accountability — as opposed to a desk card, which is the standing obligations that come with a seat and never finish. If the work has an end, it is a project.",
    marks: [
      "Start one. Anybody from project manager upwards can.",
      "The list. Health is the column that matters: it is calculated from what is actually happening, not typed in by whoever wrote the status report.",
    ],
    note: "This project is red because a milestone passed unmet, there is an unresolved blocking issue, and a third of its tasks are overdue. Nobody decided to report it red — the figures did.",
  },
  {
    part: "Running a project",
    title: "Starting one",
    img: "02-new-project.jpg",
    body: "Three people are asked for, separately, because they are three different jobs. One person can hold more than one of them, but the form will not assume it.",
    marks: [
      "A short code you can quote in an email or a steering pack.",
      "What it is called.",
      "Owner — carries the outcome.",
      "Project manager — runs it day to day.",
      "Sponsor — clears the way. Optional, and often the answer to “who do I escalate to”.",
      "Creates it in planning. It generates nothing and reports nothing until there is something in it.",
    ],
  },
  {
    part: "Running a project",
    title: "Reading a project",
    img: "03-project-overview.jpg",
    body: "The top of the screen is the whole story: who answers for it, where it is, and why the traffic light is the colour it is.",
    marks: [
      "Owner, sponsor, manager and status. These are the four questions a steering meeting opens with.",
      "Why this health, in plain words. A traffic light nobody can interrogate gets ignored or argued with; one that explains itself gets acted on.",
      "Recalculate, if you have just changed something elsewhere and want the figure now.",
    ],
    note: "Health is recalculated automatically whenever a milestone, risk or task on the project changes. The button is for impatience, not correctness.",
  },
  {
    part: "The moving parts",
    title: "Who answers for it, and what is due",
    img: "04-raci-milestones.jpg",
    body: "RACI on the left, milestones on the right. Both feed how the project reports itself.",
    marks: [
      "Add somebody and give them a role. Exactly one person is Accountable at a time — assigning a second asks you to confirm the replacement rather than quietly displacing them.",
      "Assign.",
      "Tick a milestone to report it met. The date it was met is recorded, not just the fact.",
      "Delete one that was never real. A milestone already reported met cannot be deleted — re-open it first if that was wrong.",
      "Add a milestone: a name and the date it is committed for.",
    ],
    note: "A date that passes unmet turns the project red on its own. That is the point of recording it: a project with no milestones reads green however late it is.",
  },
  {
    part: "The moving parts",
    title: "Risks, issues and decisions",
    img: "05-risks-decisions.jpg",
    body: "Two different things, deliberately kept apart. A risk is something that could go wrong and is somebody's job to chase. A decision is a question that needs an answer from a named person.",
    marks: [
      "Raise a risk. Tick blocking if the project genuinely cannot finish until it is resolved.",
      "Stand it down — or escalate it — always with a reason, because a blocking issue stops the project closing.",
      "Resolve it. You are asked how, not just that: that note is what somebody reads a year later.",
      "Decide an open decision — see the next page.",
    ],
    note: "One open blocking issue is amber, two are red, and any of them refuses project completion with a message naming what is outstanding.",
  },
  {
    part: "The moving parts",
    title: "A decision has one Approver",
    img: "06-decide.jpg",
    body: "Decisions use DACI: a Driver who does the work of deciding, and an Approver who signs it off. The sign-off is the part that is enforced.",
    marks: [
      "What was decided, and why. Recorded with the decision, so the reasoning survives the meeting.",
      "Approve.",
      "Or reject — also recorded, with the reasoning.",
    ],
    note: "The screen names who may do it. Only that person can; the button is offered to everybody because the refusal is clearer than a greyed-out control with no explanation.",
  },
  {
    part: "The moving parts",
    title: "Not even an administrator",
    img: "07-approver-only.jpg",
    body: "This is what happens when somebody other than the named Approver signs off — in this case a system administrator, the most privileged role in workPulse.",
    marks: [
      "“Sign-off cannot be delegated, escalated or overridden.” Not by the Driver who did the work, not by a manager, not by an administrator.",
    ],
    note: "A decision closed by the wrong person is not a decision — it is somebody else's opinion wearing its clothes. If the Approver is unavailable, change the Approver; that change is itself recorded.",
  },
  {
    part: "The moving parts",
    title: "The work that counts towards it",
    img: "08-project-tasks.jpg",
    body: "Tasks are not created inside a project. They are ordinary tasks — somebody's work, with the same lifecycle, reviewer and evidence rules — and the project link says which body of work they count towards.",
    marks: [
      "Add a task. Only tasks that are not already in a project are offered: a task counts towards one project, or none.",
      "The project's work, with its dependencies, owner, priority and status.",
      "Take one out, with a reason — the project's figures change when it leaves.",
    ],
    note: "This is where “33% of tasks are overdue” comes from. A project with no tasks in it has nothing to count, which is why its health stays green no matter how late it feels.",
  },
  {
    part: "Reporting",
    title: "Status, and disagreeing with the figure",
    img: "09-status-health.jpg",
    body: "Moving a project through planning, active, on hold and completed is a recorded act with a reason. Completion is refused while open tasks or unresolved blocking issues remain, and the refusal names them.",
    marks: [
      "The status.",
      "Why it is moving. Recorded against the change.",
      "Apply it.",
      "Override the health, if you genuinely disagree with the calculation.",
      "Why you disagree — required. It is shown wherever the override is, next to the calculated value it replaced.",
    ],
    note: "The override exists because a PM sometimes knows something the arithmetic does not. It is never silent: the screen says “overridden”, keeps your reason, and keeps the number it disagreed with.",
  },
  {
    part: "Reporting",
    title: "What is not here yet",
    body: "Worth being plain about, so nobody goes looking:",
    marks: [
      "Sprints. There are no iterations, no backlog, no story points, no velocity and no burndown. If your team runs Scrum, workPulse is not where you run it.",
      "A Gantt or timeline view. Milestones are a list with dates, not a chart.",
      "Creating a task from inside a project — make the task as usual, then add it here.",
      "Project-level time and cost. Effort is recorded per task; nothing rolls it up into a budget.",
    ],
    note: "What workPulse does give a project is accountability that is enforced rather than described: one Accountable person, one Approver per decision, health computed from facts, and every change in an audit trail. Use it for the governance; use whatever your team already likes for the sprint mechanics.",
  },
];

const doc = new PDFDocument({ size: "A4", margin: 46, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width - 92;

// --------------------------------------------------------------------- cover
doc.rect(0, 0, doc.page.width, 210).fill(NAVY);
doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(32).text("Projects in workPulse", 46, 72);
doc.font("Helvetica").fontSize(14).fillColor("#c9d6e8").text("For the technology and project management team", 46, 116);
doc.fontSize(10).fillColor("#8fa6c4").text("Shah Investors Home Limited", 46, 148);

doc.fillColor("#1b2430").font("Helvetica").fontSize(11);
doc.text(
  "This guide covers running a project in workPulse: who answers for it, what is due, what could go wrong, what has to be decided, and the work that counts towards it. Every picture is the real application, and the red numbers on it match the numbered notes beside it.",
  46,
  250,
  { width: W, lineGap: 3 },
);
doc.moveDown(0.8);
doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("Read the last page first if you are short of time.", { width: W });
doc.font("Helvetica").fillColor("#1b2430").text(
  "It says plainly what workPulse does not do — sprints above all — so you can decide what belongs here and what belongs in the tool your team already uses.",
  { width: W, lineGap: 3 },
);

doc.moveDown(1.3);
doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("WHAT IS IN HERE", { characterSpacing: 0.8 });
doc.moveDown(0.5);
let lastPart = null;
steps.forEach((s, i) => {
  if (s.part !== lastPart) {
    lastPart = s.part;
    doc.moveDown(0.35);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(RED).text(s.part.toUpperCase(), { characterSpacing: 0.5 });
    doc.moveDown(0.2);
  }
  doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text(`${i + 1}.  ${s.title}`, { indent: 10 });
});

doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT);
doc.text(
  "Screens shown with a sample project on an internal system. Creating and running a project needs the project manager role or above; everybody else sees it read-only.",
  46,
  doc.page.height - 78,
  { width: W },
);

// --------------------------------------------------------------------- steps
doc.moveDown(1);
doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT).text(
  "Screens here were captured on 18-19 October. The interface has moved on in one visible way since: the sidebar has gained SLA targets. Everything else in these pictures still matches the application.",
  46,
  doc.y,
  { width: W, lineGap: 2 },
);

steps.forEach((s, i) => {
  doc.addPage();

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(RED).text(s.part.toUpperCase(), 46, 46, { characterSpacing: 0.8 });
  doc.font("Helvetica-Bold").fontSize(19).fillColor(NAVY).text(`${i + 1}.  ${s.title}`, 46, 62);
  doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text(s.body, 46, 94, { width: W, lineGap: 2.5 });

  let y = doc.y + 12;

  if (s.img) {
    const imgH = frameHeight(SHOTS + s.img, W);
    doc.save();
    doc.roundedRect(46, y, W, imgH, 4).lineWidth(0.8).strokeColor("#d6dbe2").stroke();
    doc.image(SHOTS + s.img, 46, y, { width: W });
    doc.restore();
    y += imgH + 16;
  }

  s.marks.forEach((m, n) => {
    if (s.img) {
      doc.save();
      doc.circle(54, y + 5, 8).fill(RED);
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text(String(n + 1), 46, y + 1.5, {
        width: 16,
        align: "center",
      });
      doc.restore();
    } else {
      // No picture to point at, so the marks are a list rather than callouts.
      doc.save();
      doc.circle(52, y + 6, 2.5).fill(RED);
      doc.restore();
    }
    doc
      .font("Helvetica")
      .fontSize(s.img ? 10 : 11)
      .fillColor("#1b2430")
      .text(m, 72, y, { width: W - 26, lineGap: 2.5 });
    y = doc.y + (s.img ? 8 : 11);
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

// -------------------------------------------------------------- page numbers
const range = doc.bufferedPageRange();
for (let p = 1; p < range.count; p++) {
  doc.switchToPage(p);
  // Writing below the bottom margin is what makes pdfkit start a new page.
  doc.page.margins.bottom = 0;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(LIGHT)
    .text(`workPulse project guide   ·   ${p} of ${range.count - 1}`, 46, doc.page.height - 34, {
      width: W,
      align: "right",
    });
}

doc.end();
console.log("written " + OUT);
