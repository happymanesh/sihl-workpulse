/**
 * Builds the administrator guide.
 *
 * Same contract as the other three generators: the numbered markers are drawn
 * on the page before capture, so the numbers in the picture and the numbers in
 * the text are the same thing. A page with no `img` is a text page.
 */
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const SHOTS = path.join(__dirname, "guide-images-admin") + path.sep;
const OUT = path.join(__dirname, "workPulse-admin-guide.pdf");

const NAVY = "#0f2d52";
const RED = "#e11d48";
const GREY = "#5b6472";
const LIGHT = "#9aa3ae";

const steps = [
  {
    part: "What you own",
    title: "Three masters, one join",
    img: "01-service-health.jpg",
    body: "Start here, because it decides what you can and cannot fix inside workPulse. Synapse owns identity and roles. Frappe HR owns the org — people, departments, reporting lines. workPulse owns the join between them, and nothing else about either.",
    marks: [
      "Service health. Database and Redis are workPulse's own; if either is down, nothing works.",
      "The Synapse directory is a hard dependency, not a nicety. Identity is re-checked against it on every single request, so if this says anything but connected, workPulse is authenticating nobody.",
    ],
    note: "The practical consequence: when somebody's department is wrong, fix it in Frappe HR. When their role is wrong, fix it in Synapse. Editing the copy here would be overwritten by the next sync, which is why there is no screen that lets you.",
  },
  {
    part: "Access",
    title: "Who can reach what",
    img: "02-role-coverage.jpg",
    body: "Access is where you spend most of your time. Every workPulse role, what reaches it, and — the column that matters — whether anybody can reach it at all.",
    marks: [
      "A role nobody can reach. No Synapse role maps to it and nobody holds it directly, so the controls behind it cannot be exercised by anyone. This fails closed rather than over-granting, but it has to be fixed before go-live rather than discovered during it.",
      "The coverage table. Read it top to bottom before any release.",
    ],
    note: "Identity resolution is deny-by-default with no fallback role. A user whose Synapse roles map to nothing is refused entry entirely — they do not quietly become an employee.",
  },
  {
    part: "Access",
    title: "Mapping a Synapse role",
    img: "03-synapse-roles.jpg",
    body: "A mapping says what a Synapse role means in workPulse. It is done once per role, org-wide — not per person. Assigning the role to somebody happens in Synapse, and workPulse re-reads it on every request, so revoking takes effect on their next click rather than when their session expires.",
    marks: [
      "Every Synapse role that actually exists, and what it maps to. Mappings are explicit rows, never name matching: inferring that “SIHL_MANAGER” means MANAGER would break silently the first time somebody renamed a role.",
      "CLIENT_SELF can never be mapped, at any privilege level. Synapse authenticates external clients as well as staff — mapping it even to the lowest role would hand customers workPulse accounts and desk cards.",
      "A role with no mapping grants nothing. That is a decision to make deliberately, not a gap to leave.",
    ],
    note: "A direct grant is the exception, for roles Synapse has no equivalent for — notably Audit, which has to sit outside the line hierarchy. Prefer creating the role in Synapse and mapping it: that survives people joining and leaving, which a per-person grant does not.",
  },
  {
    part: "Access",
    title: "Giving somebody a shorter menu",
    img: "04-menus.jpg",
    body: "If a team should open workPulse and see four entries rather than fourteen, untick the rest. The list offered is exactly what that person's roles already grant.",
    marks: [
      "Who you are adjusting; their roles are shown beneath.",
      "Untick to hide. Their own tasks can never be hidden.",
      "Why. Recorded with the change.",
      "Applies the next time they load workPulse — no re-login.",
    ],
    note: "This is a tidier desk, not a permission. It cannot show anybody an entry their roles do not grant, and hiding one does not stop them opening it. If somebody genuinely must not reach a screen, change their role in Synapse — that is the control that is enforced.",
  },
  {
    part: "Governance",
    title: "What no control covers",
    img: "05-controls.jpg",
    body: "The governance chain is desk card → activity → process → policy. This screen reports how much of it actually holds, and names what does not.",
    marks: [
      "Coverage by process: the control, the policy it serves, its owner, and how much of the work claiming it is genuinely covered.",
      "Orphans — activities serving no process, and processes serving no policy. Mapping decays unless the decay is visible, which is why this is a permanent panel rather than a one-off migration report.",
      "Generated manuals: a point-in-time snapshot of the chain. Regenerating creates a new version rather than replacing the last.",
    ],
    note: "Coverage is reported, never enforced retrospectively. A control environment that halted work the moment its documentation lapsed would simply be switched off, and then you would have neither the work nor the control.",
  },
  {
    part: "Governance",
    title: "Creating the controls",
    img: "06-policies.jpg",
    body: "When a desk card activity has no process to serve, this is where one is created.",
    marks: [
      "The chain, stated on the screen so nobody has to remember the order.",
      "A policy. Its owner and approver must be different people — approving your own policy is not a control.",
      "A process. It can stand without a policy, but most should name the one they serve.",
    ],
  },
  {
    part: "Oversight",
    title: "MIS",
    img: "07-mis.jpg",
    body: "Four levels, each drillable into the one below and finally into the tasks themselves: enterprise, department, employee, task. Every figure above is traceable to the work that produced it.",
    marks: [
      "The period, and the level you are looking at.",
      "By department. The scope is always disclosed — you are told what this view does and does not include rather than left to assume.",
    ],
    note: "Figures here are operational, not a performance rating. Analytics about a person are visible to that person at the same time and in the same form as to their manager and HR; there is no manager-only view of somebody's numbers.",
  },
  {
    part: "Oversight",
    title: "Evidence for HR",
    img: "08-appraisal.jpg",
    body: "An appraisal snapshot per employee per cycle. Generating one is itself an audited act, because pulling somebody's performance evidence is an event worth recording.",
    marks: [
      "Pick the department.",
      "HR's cycle label — opaque to workPulse, so it matches whatever HR already calls it.",
      "Generate. The snapshot is frozen at that moment: an appraisal conversation must reference a fixed artifact, not a figure that moves between HR reading it and the employee being shown it.",
    ],
    note: "Five components and deliberately no sixth combining them — this is evidence, not a score. Insufficient volume is reported as insufficient data, never as zero: somebody on extended leave and somebody performing badly must not look identical. “Seen by subject” is tracked, because analytics are never hidden from the person they describe.",
  },
  {
    part: "Oversight",
    title: "Command Centre",
    img: "09-command-centre.jpg",
    body: "The enterprise feed: missed recurring compliance obligations, SLA breaches, blocked work, each raised once and held open until resolved.",
    marks: [
      "Enterprise status, with the prior period beside it for comparison.",
      "The open events. Each names the task, the department and the person, and says what happened in a sentence.",
    ],
    note: "Events are de-duplicated rather than re-raised: the same obligation missed on five days produces five distinct events, but one event is never raised twice for the same thing. If this list is long, that is a finding, not a bug.",
  },
  {
    part: "Oversight",
    title: "Screens you cannot see — Flags",
    img: "10-flags-refused.jpg",
    body: "This is a system administrator being refused. Flags — the anti-gaming review queue — is for Department Heads, Audit and Executives. Administration is not oversight of people.",
    marks: [
      "“Only a Department Head, Audit or an Executive may review flags.” The entry is also absent from your menu, so the refusal is consistent rather than a surprise.",
    ],
    note: "Flags never penalise anybody automatically. Flagged work leaves both the numerator and the denominator until a human reviews it with a written reason — a heuristic that quietly docked somebody's numbers would be worse than having none, because it would be wrong invisibly.",
  },
  {
    part: "Oversight",
    title: "...and the shadow quarter",
    img: "11-shadow-refused.jpg",
    body: "The same again, more strictly: the shadow-quarter scoring review requires the Audit role and nothing else will do.",
    marks: [
      "“Requires one of: AUDIT.” Not a system administrator, not an executive.",
    ],
    note: "Audit is required to sit outside the line hierarchy, and a role that an administrator could grant themselves and then read would not be outside anything. If you need this view, the answer is a reviewed grant of the Audit role — recorded, and reportable to whoever asks who holds it.",
  },
  {
    part: "Running it",
    title: "Jobs, and what they do",
    body: "Four things run on a schedule rather than when somebody clicks. If work stops appearing, this is the list to walk:",
    marks: [
      "Recurrence — generates tasks from approved desk card activities, honouring each activity's lead time. If a team's recurring work has stopped, check the card is approved and has a holder before suspecting the job.",
      "Frappe HR sync — refreshes the employee and department read-cache. Only this job writes those tables; nothing in the UI does.",
      "Anti-gaming — scans closures for missing evidence, reassignment patterns and trivial-task runs, and raises flags for a human to review.",
      "Command Centre and SLA prediction — raise events and assess open work hourly.",
      "There is also a role-mapping job for bulk Synapse mappings, and an attachment store on disk at ATTACHMENT_DIR which must be on a backed-up volume: lose it and the rows survive but the evidence does not.",
    ],
    note: "SESSION_SECRET must be identical to Synapse's. If it drifts, every request fails authentication at once and the symptom looks like an outage rather than a configuration change.",
  },
  {
    part: "Running it",
    title: "Known gaps",
    body: "Things an administrator will find before anybody reports them:",
    marks: [
      "“Employees” in the sidebar leads to a page that does not exist — the route was never built, so the link 404s. The employee data itself is intact and read through other screens.",
      "The shadow-quarter screen is reachable only by typing the URL; it is not in the menu for anybody.",
      "No screen raises a one-off task, and tasks cannot be reassigned — both matter mostly to managers, but you will field the question.",
      "SLA definitions have no admin screen, so the At risk view stays empty until they are configured directly.",
      "Source-system intake is built but has no endpoint, so nothing can yet post tickets in from an issue tracker.",
    ],
    note: "None of these is a design problem; they are unbuilt pieces. Listed here so the first person to hit one knows it is known rather than broken.",
  },
];

const doc = new PDFDocument({ size: "A4", margin: 46, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width - 92;

// --------------------------------------------------------------------- cover
doc.rect(0, 0, doc.page.width, 210).fill(NAVY);
doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(33).text("Administering workPulse", 46, 72);
doc.font("Helvetica").fontSize(14).fillColor("#c9d6e8").text("A guide for system administrators", 46, 118);
doc.fontSize(10).fillColor("#8fa6c4").text("Shah Investors Home Limited", 46, 150);

doc.fillColor("#1b2430").font("Helvetica").fontSize(11);
doc.text(
  "Every picture here is the real application, and the red numbers on it match the numbered notes beside it — where the text says 1, look for the 1 in the picture.",
  46,
  250,
  { width: W, lineGap: 3 },
);
doc.moveDown(0.8);
doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text("Two things to take from this guide.", { width: W });
doc.font("Helvetica").fillColor("#1b2430").text(
  "First, workPulse owns less than you would expect: identity belongs to Synapse, the org belongs to Frappe HR, and most “fix it here” instincts are wrong. Second, being an administrator is not the same as having every permission — there are screens you cannot open, on purpose, and that is the system working.",
  { width: W, lineGap: 3 },
);

doc.moveDown(1.1);
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
  "Screens captured as a system administrator on an internal system, including the two that refused the role.",
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
      .fontSize(s.img ? 9.5 : 10.5)
      .fillColor("#1b2430")
      .text(m, 72, y, { width: W - 26, lineGap: 2.2 });
    y = doc.y + (s.img ? 7 : 10);
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
    .text(`workPulse administrator guide   ·   ${p} of ${range.count - 1}`, 46, doc.page.height - 34, {
      width: W,
      align: "right",
    });
}

doc.end();
console.log("written " + OUT);
