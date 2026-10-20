/**
 * Builds the manager guide: setting up work for a team.
 *
 * Same contract as the other two generators — the numbered markers are drawn
 * on the page before the screenshot is taken, so the numbers in the picture
 * and the numbers in the text are the same thing. A page with no `img` is a
 * text page, which is how the closing "not here yet" page is set.
 */
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const SHOTS = path.join(__dirname, "guide-images-mgr") + path.sep;
const OUT = path.join(__dirname, "workPulse-manager-guide.pdf");

const NAVY = "#0f2d52";
const RED = "#e11d48";
const GREY = "#5b6472";
const LIGHT = "#9aa3ae";

const steps = [
  {
    part: "Setting up recurring work",
    title: "Two kinds of work",
    img: "01-desk-cards.jpg",
    body: "Before anything else, the distinction the whole system turns on. A task is one piece of work. A desk card is the standing obligations that come with a seat — and it is the thing that creates the tasks, by itself, on schedule. If the work repeats, you do not assign it: you put it on a desk card once.",
    marks: [
      "The cards in your department: the role, who holds it, how many obligations it carries, and whether it has been approved.",
      "Start a new one.",
    ],
    note: "A card belongs to the seat, not the person. When somebody moves on, the card and everything on it transfers — which is why nothing has to be reconstructed from memory the week they leave.",
  },
  {
    part: "Setting up recurring work",
    title: "Create the card",
    img: "02-new-desk-card.jpg",
    body: "Name the role, not the person. “Market Risk Analyst”, not “Priya's work”.",
    marks: [
      "A short, stable code you can quote — it outlives whoever holds the seat.",
      "What the role is called.",
      "The department it sits in.",
      "What the seat is for. Worth writing: it is what the next holder reads first.",
      "Creates it in draft. It generates nothing until it is approved and has a holder.",
    ],
  },
  {
    part: "Setting up recurring work",
    title: "The card before it does anything",
    img: "03-draft-card.jpg",
    body: "A draft card with obligations on it, none of them live yet. This is the state most of the work happens in.",
    marks: [
      "Serves — the control each obligation exists for. Until this is set the activity cannot be approved.",
      "Approve is greyed for exactly that reason: offering a button and then refusing it teaches people the screen is unreliable.",
      "Add another obligation.",
      "Transfer the card to whoever holds the seat. A reason is required, and the history is kept rather than overwritten.",
    ],
    note: "An unassigned card generates no work. If your team's recurring tasks have stopped appearing, check the holder first.",
  },
  {
    part: "Setting up recurring work",
    title: "Adding an obligation",
    img: "04-add-activity.jpg",
    body: "This is the form that matters most. What you set here decides what your team is asked to do, how often, and who checks it — every month, without anybody remembering.",
    marks: [
      "What the work is. Specific enough that somebody new could act on it.",
      "The control it serves. Required before approval, so nobody is left answering “why does this task exist?” with a shrug.",
      "Who checks it. Without a reviewer the work cannot be sent for review at all.",
      "Task type. This decides whether the work needs verification, evidence or maker-checker.",
      "How long it should take — set by you, not the holder. It drives capacity and the workload figures.",
      "How often. Leave blank for a one-off obligation.",
      "Lead time: generate it this many working days before it is due, so nobody receives a filing task on the morning it is due.",
    ],
  },
  {
    part: "Setting up recurring work",
    title: "When it refuses to approve",
    img: "05-refused.jpg",
    body: "Two prerequisites catch people out. Both are deliberate, and both say so in plain words rather than failing silently.",
    marks: [
      "A verified task type needs an approved workflow as well as a control. Compliance work has steps somebody signed off; the activity cannot go live before they exist.",
      "Approve, once the prerequisites are met.",
      "The control. Set it here if you did not set it on the form.",
    ],
    note: "If you only need the obligation recorded and generated, choose an operational task type. Reserve the verified types for work where somebody must check the steps were followed.",
  },
  {
    part: "Setting up recurring work",
    title: "If the control does not exist yet",
    img: "06-controls.jpg",
    body: "Work hangs off a named control: desk card → activity → process → policy. If the process you need is not in the list, create it under Policies & processes first.",
    marks: [
      "The chain, in one line.",
      "Add a policy. Its owner and its approver must be different people — approving your own policy is not a control.",
      "Add a process. A process can stand without a policy, but most should name the one they serve.",
    ],
  },
  {
    part: "Setting up recurring work",
    title: "Approve it, and it runs",
    img: "07-approved.jpg",
    body: "Approve each activity, then the card. From here the work appears on its own, assigned to the holder, with the lead time you set.",
    marks: [
      "The card is approved.",
      "So is the obligation. Note that its control is now fixed text rather than a dropdown — an approved activity's control does not change casually.",
      "Pause generation. Use this when a process is suspended rather than deleting the activity, so the obligation and its history survive.",
    ],
    note: "Tasks generated this way say “Desk card” as their source. Your team does not have to be told about them; they arrive.",
  },
  {
    part: "Setting up recurring work",
    title: "Changing it later",
    img: "08-amend.jpg",
    body: "Corrections are made in place rather than by retiring the activity and creating a new one. What a change counts as depends on what it does, not which field moved.",
    marks: [
      "Wording — a typo or a clearer title. No reason asked.",
      "Recurrence — this changes what work exists, so an approved activity goes back to draft and has to be approved again.",
      "A reason, required as soon as the change is more than wording.",
      "Save.",
    ],
    note: "Amendments apply to work generated from now on. Tasks that already exist keep the definition they were created under — an auditor has to see the obligation that actually applied, not a later revision of it.",
  },
  {
    part: "Setting up recurring work",
    title: "Correcting the card itself",
    body: "Edit, on the card header, changes the card rather than its activities — its name, its description, and the department it belongs to.",
    marks: [
      "The department is the consequential one. A task takes its department from the CARD, not from whoever holds it, so the department decides which SLA targets apply to the work and whose head is escalated to when it breaches. A card in the wrong department quietly sends every breach to the wrong person.",
      "Moving a card between departments therefore asks for a reason, and records it.",
      "The code cannot be changed. Audit entries, exports and anything outside workPulse refer to a card by its code; a card created under the wrong one is retired and replaced rather than renamed underneath everything already pointing at it.",
    ],
    note: "Work already raised keeps the department it was raised with. Only tasks generated after the change carry the new one — so correcting a long-standing mistake fixes the future and leaves the record of the past intact.",
  },
  {
    part: "Day to day",
    title: "What you set on a single task",
    img: "09-configured-task.jpg",
    body: "Whether the task came from a desk card or was raised directly, these are the fields that decide how it behaves.",
    marks: [
      "Assignee, reviewer, type and due date. One assignee at a time — co-ownership is modelled with subtasks, never a second name here.",
      "A checklist. Every item must be done or explicitly waived before the work can be completed, which is how “done” stops being a matter of opinion.",
      "Each item, ticked by whoever does the work.",
    ],
    note: "The checklist is the cheapest control you have. Three specific lines beat a paragraph of description, and they double as evidence that the steps were followed.",
  },
  {
    part: "Day to day",
    title: "Checking your team's work",
    img: "10-verify.jpg",
    body: "When work is completed it waits for the named reviewer. This is the manager's half of the loop.",
    marks: [
      "Verify — you are satisfied it was done.",
      "Reject sends it back, with your reason recorded.",
      "A note, which is what an auditor reads alongside the dates. Dictation works here too.",
      "The checklist, now complete, shown with what was ticked.",
    ],
    note: "Nobody can verify their own work, under any role — not even a system administrator. If you are both the assignee and the reviewer, the system will refuse you, and it is right to.",
  },
  {
    part: "Day to day",
    title: "Capacity, and who is carrying what",
    img: "11-capacity.jpg",
    body: "Team workload is the one screen to open each morning: open work, what is overdue, what is critical, what is blocked and on whom.",
    marks: [
      "The totals for your team.",
      "Hours a week this person can realistically absorb.",
      "Save it.",
      "Set it for everyone else. Until a person has a capacity, over-capacity cannot be calculated and they will never be reported as overloaded.",
    ],
    note: "Committed hours come from the approved activities on their desk card. If somebody's committed time already exceeds their capacity, that is a staffing fact, not a performance one — and it is visible before it becomes a missed deadline.",
  },
  {
    part: "Day to day",
    title: "Work that is going to be late",
    img: "12-at-risk.jpg",
    body: "At risk assesses open work hourly and lists what is likely to breach, with the reason.",
    marks: [
      "It will say so when it has no track record. These are estimates from an explainable rule set, not a trained model, and every prediction is scored against what actually happened.",
    ],
    note: "Empty for now because tasks with no SLA attached are not assessed at all — there is nothing for them to breach. It fills up once SLA targets are defined for your task types.",
  },
  {
    part: "Day to day",
    title: "When somebody leaves or moves",
    img: "13-handover.jpg",
    body: "Handover builds the list from live data rather than from memory — desk cards held, open tasks, project roles, delegations.",
    marks: [
      "Who is moving.",
      "Why. Leaving and changing department are not the same: somebody moving desks keeps their project roles, somebody leaving does not.",
      "Where they are going.",
      "When it takes effect.",
      "Build the list, then decide item by item what hands over and what stays. Both are recorded.",
    ],
  },
  {
    part: "Setting up recurring work",
    title: "Writing the procedure it is asking for",
    body: "When approval is refused for want of a workflow, this is where you supply one. Open the activity's row on the desk card and choose Steps.",
    marks: [
      "Write the steps in the order they are actually done, with a rough time against each. They are what the person doing the work ticks off, and what a reviewer checks against, so write them for somebody having a bad morning rather than for an auditor.",
      "Save it as a draft. A draft changes nothing: the activity still cannot be approved while the procedure is unapproved.",
      "Approving the procedure needs a SECOND person with governance rights. You cannot approve a workflow you wrote. That is the control working, not an obstacle to route around — if you are stuck, the answer is to ask a colleague, never to re-author it under another name.",
      "Later changes make a new version rather than editing the live one. Approving the new version supersedes the old, and the old stays readable — so a task completed last March can still be shown against the steps that applied in March.",
    ],
    note: "This is why Critical activities often sit in draft for a day. It is the one place the system will not let a single person act alone, and it is deliberate.",
  },
  {
    part: "Day to day",
    title: "Raising, correcting and moving a task",
    body: "Not all work comes from a desk card. These three are on the task itself and on the task list.",
    marks: [
      "Raise a one-off task for somebody: title, type, assignee, reviewer, due date, and a checklist if it helps. Use this for work that genuinely is one-off — if you find yourself raising the same thing monthly, it belongs on a desk card.",
      "Correct a task after it is raised: due date, priority, complexity, reviewer. Moving a due date asks for a reason, and the reason is kept — a date that moves three times tells a story somebody may need to read later.",
      "Reassign it to someone else. Both names and the reason are recorded. Work that has already been completed or sent for review cannot be moved; reopen it first, because moving it silently would undo a completion somebody signed their name to.",
    ],
    note: "Reassigning overdue work away from one person repeatedly is itself a pattern the system flags. That is not an accusation — it is there so that a genuine workload problem surfaces as a workload problem rather than as one person's bad numbers.",
  },
  {
    part: "Day to day",
    title: "SLA targets",
    body: "If you are a department head you can set these yourself, under SLA targets in the sidebar.",
    marks: [
      "A target is matched to work from the most specific rule that fits — by task type, priority and department — so a general rule can sit underneath a narrow one without fighting it.",
      "The clock pauses while a task is blocked or on hold, so somebody waiting on a third party is not charged for the wait.",
      "Escalation is defined by relationship, not by name: the assignee's manager, then the department head. Nothing has to be rewritten when somebody leaves.",
      "Extending a target that already exists asks for a reason. Quietly relaxing a target is exactly how an SLA stops meaning anything.",
    ],
    note: "Until targets exist, the At risk screen stays quiet — not because it is broken, but because nothing has been promised yet.",
  },
  {
    part: "Day to day",
    title: "What you cannot do yet",
    body: "Worth knowing before you go looking for it:",
    marks: [
      "Create a task directly inside a project in one step. You can raise a task and then attach it to a project, which is two actions where it should be one.",
      "See a project as a Gantt chart or timeline. Milestones and risks are listed, not plotted.",
      "Sprints. Deliberately out of scope — engineering keeps its board in its own tool, and workPulse holds the standing obligations an auditor would ask about rather than this fortnight's tickets.",
    ],
    note: "The four items listed here on 18 October have all since been built: raising a one-off task, reassigning one, correcting a due date or priority, and setting SLA targets yourself. They are described earlier in this guide — if you half-remember being told they were missing, that is why.",
  },
];

const doc = new PDFDocument({ size: "A4", margin: 46, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width - 92;

// --------------------------------------------------------------------- cover
doc.rect(0, 0, doc.page.width, 210).fill(NAVY);
doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(31).text("Setting up your team's work", 46, 72);
doc.font("Helvetica").fontSize(14).fillColor("#c9d6e8").text("A guide for managers and department heads", 46, 116);
doc.fontSize(10).fillColor("#8fa6c4").text("Shah Investors Home Limited", 46, 148);

doc.fillColor("#1b2430").font("Helvetica").fontSize(11);
doc.text(
  "Every picture here is the real application, and the red numbers on it match the numbered notes beside it — where the text says 1, look for the 1 in the picture.",
  46,
  250,
  { width: W, lineGap: 3 },
);
doc.moveDown(0.8);
doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("The one idea to take from this guide:", { width: W });
doc.font("Helvetica").fillColor("#1b2430").text(
  "you do not hand out recurring work. You describe the obligations a seat carries, once, and the system issues the work on schedule for as long as somebody holds that seat. Most of what follows is how to describe them well.",
  { width: W, lineGap: 3 },
);

doc.moveDown(1.2);
doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("WHAT IS IN HERE", { characterSpacing: 0.8 });
doc.moveDown(0.5);
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

doc.font("Helvetica").fontSize(8.5).fillColor(LIGHT);
doc.text(
  "Screens shown with sample data on an internal system. Creating desk cards and approving activities needs the department head or system administrator role.",
  46,
  doc.page.height - 78,
  { width: W },
);

// --------------------------------------------------------------------- steps
steps.forEach((s, i) => {
  doc.addPage();

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(RED).text(s.part.toUpperCase(), 46, 46, { characterSpacing: 0.8 });
  doc.font("Helvetica-Bold").fontSize(19).fillColor(NAVY).text(`${i + 1}.  ${s.title}`, 46, 62);
  doc.font("Helvetica").fontSize(10.5).fillColor("#1b2430").text(s.body, 46, 94, { width: W, lineGap: 2.5 });

  let y = doc.y + 12;

  if (s.img) {
    const imgH = (W * 544) / 799;
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
      doc.save();
      doc.circle(52, y + 6, 2.5).fill(RED);
      doc.restore();
    }
    doc
      .font("Helvetica")
      .fontSize(s.img ? 9.7 : 11)
      .fillColor("#1b2430")
      .text(m, 72, y, { width: W - 26, lineGap: 2.2 });
    y = doc.y + (s.img ? 7 : 11);
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
  doc.page.margins.bottom = 0;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(LIGHT)
    .text(`workPulse manager guide   ·   ${p} of ${range.count - 1}`, 46, doc.page.height - 34, {
      width: W,
      align: "right",
    });
}

doc.end();
console.log("written " + OUT);
