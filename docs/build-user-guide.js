/**
 * Builds the workPulse user guide as a PDF.
 *
 * The screenshots were taken from the running application with the numbered
 * markers drawn on the page itself, so the numbers in the picture and the
 * numbers in the text are the same thing. Keeping the captions beside the
 * image rather than in a separate legend means a reader never has to hold a
 * number in their head while they scroll.
 */
const PDFDocument = require("pdfkit");
const fs = require("fs");

const SHOTS = "C:/Users/ManeshMukherjee/.claude/projects/C--Projects-CentrumWebsite/87227dae-13e0-4a29-86b5-a10042f56276/tool-results/";
const OUT = "C:/Projects/SIHL_workPulse/docs/workPulse-user-guide.pdf";

const NAVY = "#0f2d52";
const RED = "#e11d48";
const GREY = "#5b6472";
const LIGHT = "#9aa3ae";

const steps = [
  {
    part: "Part 1 — Everybody",
    title: "Finding your way around",
    img: "mcp-Claude_Browser-blob-1792314373429-7j1mpa.jpg",
    body: "workPulse opens on your own work. Everything is reached from the menu down the left; what you see there depends on your role, so your menu may be shorter than the one in this picture. That is normal.",
    marks: [
      "The menu. Your screens, grouped — your own work at the top, then anything your role adds.",
      "Collapses the menu to icons when you want the width back. Ctrl+B does the same. It remembers.",
      "Your initials: profile, settings, help, light or dark, and sign out.",
      "Your task list. Every row is one piece of work with its own reference number (WP-000385).",
    ],
  },
  {
    part: "Part 1 — Everybody",
    title: "Opening a task",
    img: "mcp-Claude_Browser-blob-1792314490536-v90mu2.jpg",
    body: "Click any row to open it. The strip across the middle is the task's life so far — where it has been and where it is now. Work arrives Assigned and you take it from there.",
    marks: [
      "Accept says you have seen it and it is yours. Only the moves that are legal right now are offered; the rest are hidden rather than shown and refused.",
      "The facts: who it is for, who checks it, when it is due, how long it should take, where it came from.",
    ],
    note: "A task generated from a desk card says Desk card under SOURCE. It appeared because your desk card says this work happens — nobody had to remember to create it.",
  },
  {
    part: "Part 1 — Everybody",
    title: "Evidence: files and notes",
    img: "mcp-Claude_Browser-blob-1792314525331-r9fim0.jpg",
    body: "Work that is closed with nothing behind it gets flagged for review. Three things count as evidence, and any one of them is enough: a ticked checklist item, a file, or a note.",
    marks: [
      "Attach a file — up to 25 MB. Documents, spreadsheets, images and saved email. No zips, since a zip proves nothing until somebody opens it.",
      "Write a note: what you did, or what the next person needs to know.",
      "Or dictate it. Ten seconds, any language you speak — the note is saved in English so whoever picks the work up can read it.",
      "Add note. Notes cannot be edited or deleted afterwards: correct one by adding another, the way a ledger is corrected.",
    ],
    note: "A file can be withdrawn with a reason until the task is verified. After that it is part of the record and stays — attach a correction instead.",
  },
  {
    part: "Part 1 — Everybody",
    title: "Your desk card",
    img: "mcp-Claude_Browser-blob-1792314554460-fxclw3.jpg",
    body: "A desk card is the seat, not the person. It lists the standing obligations that come with your role — and it is what generates your recurring work automatically. You may hold more than one.",
    marks: [
      "Acknowledge records that you have seen the card. It changes nothing about what is generated; work continues either way.",
      "The standing obligations: what recurs, how often, how long each should take.",
    ],
    note: "If the card moves to somebody else, these obligations move with it. Tasks already created stay with whoever has them.",
  },
  {
    part: "Part 1 — Everybody",
    title: "The board",
    img: "mcp-Claude_Browser-blob-1792314577194-7p3rwn.jpg",
    body: "The same work as a board, by status. Useful first thing in the morning when you want to see what is waiting rather than read a list.",
    marks: [
      "Every card has a Move to… control for the moves that are legal from where it currently is.",
      "The same control on another card. The columns are the stages a task passes through.",
    ],
  },
  {
    part: "Part 1 — Everybody",
    title: "The calendar, and blocking time",
    img: "mcp-Claude_Browser-blob-1792314597945-pjrxnq.jpg",
    body: "Your week. The bar at the top shows what your desk card has committed you to, against the capacity your manager has set.",
    marks: [
      "Pick the task you are about to work on.",
      "Block the time. Blocked time is how a full week stops looking like an empty one.",
      "Move between weeks, or switch to a day or month view.",
    ],
  },
  {
    part: "Part 1 — Everybody",
    title: "Your own numbers",
    img: "mcp-Claude_Browser-blob-1792314614621-0wefv5.jpg",
    body: "You see your figures at the same time and in the same form as your manager and HR. There is no manager-only view of your performance.",
    marks: [
      "Below a minimum volume, nothing is reported rather than a low score shown. A month on leave and a difficult month would otherwise look identical.",
      "Anything flagged is listed openly and is excluded from the figures entirely until a human reviews it, with a written reason.",
    ],
    note: "If you think a figure about you is wrong, raise it with HR or Audit directly, not only with your manager. That route is deliberate.",
  },
  {
    part: "Part 2 — Managers",
    title: "Team workload",
    img: "mcp-Claude_Browser-blob-1792314625663-53b771.jpg",
    body: "Who is carrying what, in one table: open work, how much is critical, what is overdue, what is blocked and on whom.",
    marks: [
      "Set capacity against a person to say what a reasonable week looks like for them. Until that is set, over-capacity cannot be calculated and nobody is reported as overloaded.",
    ],
  },
  {
    part: "Part 2 — Managers",
    title: "When somebody leaves or moves",
    img: "mcp-Claude_Browser-blob-1792314653826-os0ke8.jpg",
    body: "Handover builds the list from live data rather than from memory — desk cards held, open tasks, roles on projects, delegations. Anything they genuinely picked up this week is in it.",
    marks: [
      "Who is moving.",
      "Why. Leaving and moving department are not the same: somebody changing desks keeps their project roles, somebody leaving does not.",
      "Where they are going, when that applies.",
      "The date it takes effect.",
      "Build the list. Nothing is hidden from it — you decide what hands over and what stays, and both are recorded.",
    ],
  },
  {
    part: "Part 3 — Administrators",
    title: "Desk cards",
    img: "mcp-Claude_Browser-blob-1792314665232-vrexx1.jpg",
    body: "Every recurring obligation in the firm lives on a desk card. This is where they are created and who holds them is recorded.",
    marks: [
      "The cards, their department, who holds each one and whether it is approved.",
      "New desk card. A card starts in draft and generates nothing until it and at least one of its activities are approved.",
    ],
  },
  {
    part: "Part 3 — Administrators",
    title: "Inside a desk card",
    img: "mcp-Claude_Browser-blob-1792314694501-4p9we5.jpg",
    body: "The activities on a card are what generate the work. Each one names the control it serves, so nobody is ever left answering \u201cwhy does this task exist?\u201d with a shrug.",
    marks: [
      "Transfer the card to somebody else. A reason is required and the history is kept rather than overwritten.",
      "The activities: what recurs, how often, the control each serves, and whether it is approved.",
      "Edit an activity — see the next page.",
      "Add an activity. It starts in draft and cannot be approved until it serves a named control.",
    ],
  },
  {
    part: "Part 3 — Administrators",
    title: "Changing an activity",
    img: "mcp-Claude_Browser-blob-1792314704700-qeew2k.jpg",
    body: "Corrections are made in place rather than by retiring the activity and creating a new one. What a change counts as depends on what it does, not on which field moved.",
    marks: [
      "Wording — a typo or a clearer title. No reason asked.",
      "Recurrence — this changes what work exists, so an approved activity goes back to draft and somebody has to approve it again.",
      "A reason, required as soon as the change is more than wording. It is recorded against the amendment.",
      "Save. Changes apply to work generated from now on.",
    ],
    note: "Tasks that already exist keep the definition they were created under. An auditor has to see the obligation that actually applied, not a later revision of it. To change a task that exists today, edit that task.",
  },
  {
    part: "Part 3 — Administrators",
    title: "Policies and processes",
    img: "mcp-Claude_Browser-blob-1792314720805-axmdlp.jpg",
    body: "Work hangs off a named control. Create the process first where there is one; an activity cannot be approved until it serves one.",
    marks: [
      "The chain: desk card \u2192 activity \u2192 process \u2192 policy.",
      "Add a policy. Its owner and its approver must be different people — approving your own policy is not a control.",
      "Add a process. A process can stand without a policy, but most should name the policy they serve.",
    ],
  },
  {
    part: "Part 3 — Administrators",
    title: "Who can reach what",
    img: "mcp-Claude_Browser-blob-1792314748719-7um9h5.jpg",
    body: "Roles come from Synapse. workPulse maps a Synapse role onto a workPulse role once, org-wide, and re-reads it on every request — so revoking somebody's role takes effect on their next click, not when their session expires.",
    marks: [
      "A role nobody can reach. The controls behind it cannot be exercised by anyone, so this has to be fixed before go-live rather than discovered during it.",
      "Coverage: every workPulse role, what reaches it, and whether anybody can.",
    ],
    note: "Assigning a role to a person happens in Synapse. A direct grant here is the exception, for roles Synapse has no equivalent for.",
  },
  {
    part: "Part 3 — Administrators",
    title: "Giving somebody a shorter menu",
    img: "mcp-Claude_Browser-blob-1792314739352-jhzqih.jpg",
    body: "If a team should open workPulse and see four things rather than fourteen, untick the rest. The list offered is exactly what that person's roles already grant.",
    marks: [
      "Who you are adjusting. Their roles are shown beneath.",
      "Untick to hide. Their own tasks can never be hidden — an empty menu looks like a broken application.",
      "Why. Recorded with the change.",
      "Save. It applies the next time they load workPulse; they do not need to sign in again.",
    ],
    note: "This is a tidier desk, not a permission. Hiding a screen does not stop somebody opening it, and it changes nothing about what the system will hand them — their role decides that. If somebody genuinely should not reach a screen, change their role in Synapse.",
  },
  {
    part: "Everyday",
    title: "Your account",
    img: "mcp-Claude_Browser-blob-1792314759981-4s1ej7.jpg",
    body: "Everything about you sits behind your initials, top right.",
    marks: [
      "Profile shows who workPulse thinks you are and where each fact came from. Settings holds light or dark. Signing out returns you to Synapse and leaves you signed in there.",
    ],
  },
  {
    part: "Everyday",
    title: "More room when you need it",
    img: "mcp-Claude_Browser-blob-1792314780371-7oky3r.jpg",
    body: "Collapsed, the menu keeps its icons rather than disappearing, so you can still see where you are and still get anywhere in one click. Hover an icon for its name.",
    marks: [
      "The rail. Your current screen stays highlighted.",
      "Expands it again. Ctrl+B toggles either way, and the choice is remembered on this computer.",
    ],
  },
];

const doc = new PDFDocument({ size: "A4", margin: 46, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width - 92;

// --------------------------------------------------------------------- cover
doc.rect(0, 0, doc.page.width, 210).fill(NAVY);
doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(34).text("workPulse", 46, 72);
doc.font("Helvetica").fontSize(15).fillColor("#c9d6e8").text("A guide for everyone who uses it", 46, 118);
doc.fontSize(10).fillColor("#8fa6c4").text("Shah Investors Home Limited", 46, 150);

doc.fillColor("#1b2430").font("Helvetica").fontSize(11);
doc.text(
  "This guide walks through workPulse one screen at a time. Every picture is the real application, and the red numbers on it match the numbered notes beside it — so where it says 1, look for the 1 in the picture.",
  46,
  250,
  { width: W, lineGap: 3 },
);
doc.moveDown(0.8);
doc.text(
  "Read Part 1 whatever your job is: it is the work itself. Part 2 is for anyone with people reporting to them. Part 3 is for administrators, and most people will never need it.",
  { width: W, lineGap: 3 },
);

doc.moveDown(1.4);
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
  "Screens shown with test data on an internal system. Your own screens will differ in content and, depending on your role, in which menu entries appear.",
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

  const imgTop = doc.y + 12;
  const imgH = (W * 544) / 799;
  doc.save();
  doc.roundedRect(46, imgTop, W, imgH, 4).lineWidth(0.8).strokeColor("#d6dbe2").stroke();
  doc.image(SHOTS + s.img, 46, imgTop, { width: W });
  doc.restore();

  let y = imgTop + imgH + 16;
  s.marks.forEach((m, n) => {
    doc.save();
    doc.circle(54, y + 5, 8).fill(RED);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text(String(n + 1), 46, y + 1.5, {
      width: 16,
      align: "center",
    });
    doc.restore();
    doc.font("Helvetica").fontSize(10).fillColor("#1b2430").text(m, 72, y, { width: W - 26, lineGap: 2 });
    y = doc.y + 8;
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
  // Writing below the bottom margin is what makes pdfkit start a new page, so
  // the margin is dropped for the footer and nothing else.
  doc.page.margins.bottom = 0;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(LIGHT)
    .text(`workPulse user guide   ·   ${p} of ${range.count - 1}`, 46, doc.page.height - 34, {
      width: W,
      align: "right",
    });
}

doc.end();
console.log("written " + OUT);
