// RoleName rather than the database enum: the web app keeps no dependency on
// the db package, and nav.ts already owns that mirror.
import type { RoleName } from "@/lib/nav";

/**
 * The questions people actually ask, with the answers they actually need.
 *
 * Written against what the system really does, including the parts that look
 * like faults and are not: work appearing before it is due, a review button
 * that refuses, an activity that will not approve. Each of those has cost
 * somebody an hour of confusion already, which is the test for belonging here.
 *
 * `audience` decides who sees an entry by default. It is a reading aid, not a
 * permission: the screen lets anybody show everything, because a new manager
 * reading the manager answers before they hold a card is a good thing, and
 * pretending otherwise would just send them to ask somebody.
 *
 * Images are the same annotated screens as the printed guides, so a person who
 * has read one recognises the other.
 */
/**
 * "managers" and "governance" are separated because the system separates them.
 * A manager runs the work; a department head defines what the work is. Showing
 * a manager how to create a desk card would send them to a button that refuses
 * them, which is exactly the confusion these answers exist to remove.
 */
export type HelpAudience = "everyone" | "managers" | "governance" | "projects" | "administrators";

export interface HelpFaq {
  id: string;
  audience: HelpAudience;
  question: string;
  /** Each string is a paragraph. Kept short on purpose - this is read in a hurry. */
  answer: string[];
  /** A file under /help/, with the caption shown beneath it. */
  image?: { src: string; caption: string };
}

/** Which workPulse roles each audience is written for. */
export const AUDIENCE_ROLES: Record<Exclude<HelpAudience, "everyone">, RoleName[]> = {
  managers: ["MANAGER", "DEPARTMENT_HEAD", "SYSTEM_ADMIN"],
  // Desk cards, activities, procedures and SLA targets are all governance.
  governance: ["DEPARTMENT_HEAD", "SYSTEM_ADMIN"],
  projects: ["PROJECT_MANAGER", "DEPARTMENT_HEAD", "SYSTEM_ADMIN"],
  administrators: ["SYSTEM_ADMIN", "DEPARTMENT_HEAD"],
};

export const AUDIENCE_LABEL: Record<HelpAudience, string> = {
  everyone: "Everyone",
  managers: "If you run a team's work",
  governance: "If you define what a team is responsible for",
  projects: "If you run a project",
  administrators: "If you administer the system",
};

/** Shown beside an audience so nobody has to infer it. */
export const AUDIENCE_NOTE: Partial<Record<HelpAudience, string>> = {
  managers: "Managers and above.",
  governance: "Department heads and administrators only — a manager is refused these.",
};

export const HELP_FAQS: HelpFaq[] = [
  // ---------------------------------------------------------------- everyone
  {
    id: "where-did-this-come-from",
    audience: "everyone",
    question: "Why has this task appeared? Nobody asked me to do it.",
    answer: [
      "Because your desk card says this work happens. A desk card is the standing list of what your seat is responsible for, and it raises the work on schedule so nobody has to remember to.",
      "A task raised this way says “Desk card” under Source. One raised by a person says who raised it. If you think the obligation itself is wrong, that is a conversation about the card rather than about the task.",
    ],
    image: { src: "task-open.jpg", caption: "Source tells you where a task came from." },
  },
  {
    id: "future-tasks",
    audience: "everyone",
    question: "My list shows tasks that are not due for weeks. Is that a fault?",
    answer: [
      "No. Recurring work is raised ahead of time so you can see what is coming and plan around it, rather than discovering a monthly obligation on the morning it is due.",
      "Sort or filter by due date if the long view is noise. Nothing is late until its due date passes.",
    ],
  },
  {
    id: "why-cant-i-send-for-review",
    audience: "everyone",
    question: "I pressed Send for review and it refused. Why?",
    answer: [
      "Almost always because the task has no reviewer. Review means a named person checks the work; with nobody named there is nowhere for it to go.",
      "Your manager sets the reviewer, either on the task or on the activity that raises it. Ask them to add one — it takes a moment, and once set, future work from the same activity carries it automatically.",
    ],
    image: { src: "pending-review.jpg", caption: "Sent for review: it now sits with the named reviewer." },
  },
  {
    id: "what-can-i-do-next",
    audience: "everyone",
    question: "Why are some buttons missing on my task?",
    answer: [
      "Only the moves that are legal right now are shown. The alternative — offering everything and refusing most of it — teaches people to guess.",
      "If something you expect is absent, it is usually because the task is in a state that does not allow it. Work that has been completed or sent for review, for instance, cannot be quietly edited underneath the person checking it.",
    ],
  },
  {
    id: "blocking",
    audience: "everyone",
    question: "When should I mark something Blocked?",
    answer: [
      "When it genuinely cannot proceed until a named person does something. Blocking asks who you are waiting for, because “blocked” without a name is just a task nobody is doing.",
      "Blocked is a round trip, not a dead end: the way out is back to In progress. While it is blocked the SLA clock pauses, so you are not charged for somebody else's delay.",
    ],
    image: { src: "blocking.jpg", caption: "Blocking asks who you are waiting on." },
  },
  {
    id: "evidence",
    audience: "everyone",
    question: "Do I have to attach a file every time?",
    answer: [
      "Only where the task type asks for evidence — typically compliance and verified work. Where it does, the attachment is the proof the work happened, so a reviewer is checking something rather than taking your word for it.",
      "A note is often better than a file. Three lines saying what you checked and what you found is worth more than a screenshot nobody can interpret.",
    ],
    image: { src: "evidence.jpg", caption: "Files and notes both count as evidence." },
  },
  {
    id: "steps",
    audience: "everyone",
    question: "My task has numbered steps. Do I have to follow them?",
    answer: [
      "Yes. Where steps appear they are an approved procedure, written by whoever owns the obligation and signed off by a second person. Tick them as you actually do them rather than all at once at the end.",
      "If a step cannot be done, or is plainly wrong, say so in the remark instead of ticking it anyway. A procedure that no longer matches reality is worth reporting — that is how it gets corrected.",
    ],
  },
  {
    id: "my-numbers",
    audience: "everyone",
    question: "Where do my performance figures come from, and who sees them?",
    answer: [
      "From the work itself — what was due, what was done, when, and whether it was checked. Nothing is typed in by hand.",
      "Your manager and your department head see them. If you think a figure about you is wrong, raise it with HR or Audit directly rather than only with your manager. That route exists on purpose.",
    ],
    image: { src: "my-performance.jpg", caption: "Your own numbers, built from your own work." },
  },
  {
    id: "my-desk-card",
    audience: "everyone",
    question: "What is my desk card, and what if it is wrong?",
    answer: [
      "It is the standing list of what your seat is responsible for — the obligations that come with the job rather than with you personally. When you move seats, the card stays with the seat.",
      "If it describes work you do not do, or misses work you do, tell your manager. Cards are meant to be corrected; one that quietly drifts out of date is worse than one that was never written.",
    ],
    image: { src: "my-desk-card.jpg", caption: "Your card: the obligations your seat carries." },
  },
  {
    id: "signed-in-told-to-sign-in",
    audience: "everyone",
    question: "I am signed in to Synapse but workPulse says “Sign in to continue”.",
    answer: [
      "The message is misleading and we know it. You are signed in; what you do not have is a workPulse role.",
      "Access is deliberately deny-by-default — Synapse also authenticates clients, so nobody is given a role automatically. Ask an administrator to map your Synapse role, and it will work on your next click without you signing in again.",
    ],
  },

  // ------------------------------------------------- managers and governance
  {
    id: "activity-wont-approve",
    audience: "governance",
    question: "My activity will not approve. What is it waiting for?",
    answer: [
      "Two prerequisites catch people out, and the screen says which one is missing. Every activity needs a control — the policy or process it serves. Critical and verified work needs an approved written procedure as well.",
      "Both are deliberate. If you only need the obligation recorded and generated, an operational task type asks for less. Reserve the verified types for work where somebody must check the steps were followed.",
    ],
    image: { src: "approval-refused.jpg", caption: "It tells you what is missing rather than failing silently." },
  },
  {
    id: "write-procedure",
    audience: "governance",
    question: "How do I write the procedure it is asking for?",
    answer: [
      "Open the activity's row on the desk card and choose Steps. Write them in the order they are actually done, with a rough time against each — they are what the person doing the work ticks off and what a reviewer checks against.",
      "Approving the procedure needs a second person with governance rights. You cannot approve a workflow you wrote. If that leaves you stuck, the answer is to ask a colleague, never to re-author it under another name.",
      "Later changes make a new version rather than editing the live one, so a task completed last March can still be shown against the steps that applied in March.",
    ],
    image: { src: "procedure.png", caption: "Steps, with times — and an approval you cannot give yourself." },
  },
  {
    id: "reassign",
    audience: "managers",
    question: "How do I move a task to somebody else, or correct its due date?",
    answer: [
      "Both are under Manage on the task. Moving it asks for a reason and records it against both names; the task returns to Assigned so the new holder accepts it themselves rather than inheriting somebody else's commitment.",
      "Correcting a due date also asks for a reason and keeps it. A date that moves three times tells a story somebody may need to read later.",
      "Work already completed or sent for review cannot be moved. Reopen it first — moving it silently would undo a completion somebody signed their name to.",
    ],
    image: { src: "manage-task.png", caption: "Move it, or correct it — both leave a reason behind." },
  },
  {
    id: "wrong-department",
    audience: "governance",
    question: "A desk card is in the wrong department. Does it matter?",
    answer: [
      "Yes, more than it looks. A task takes its department from the card, not from whoever holds it, so the department decides which SLA targets apply and whose head is escalated to on a breach. A card in the wrong department quietly sends every breach to the wrong person.",
      "Edit on the card header fixes it, and asks why. Work already raised keeps the department it was raised with — only tasks generated from now on carry the new one.",
    ],
    image: { src: "card-edit.png", caption: "The department is the consequential field here." },
  },
  {
    id: "sla",
    audience: "governance",
    question: "Why is the At risk screen empty?",
    answer: [
      "Because nothing has been promised yet. At risk shows work approaching an SLA target, so with no targets configured there is nothing for it to warn about.",
      "Department heads can set targets under SLA targets. The most specific target wins, the clock pauses while work is blocked or on hold, and escalation is defined by relationship rather than by name so nothing breaks when somebody leaves.",
    ],
    image: { src: "sla.png", caption: "A target, its escalation chain, and the rules that govern both." },
  },

  // ---------------------------------------------------------------- projects
  {
    id: "raci",
    audience: "projects",
    question: "What is the difference between RACI on a project and an assignee on a task?",
    answer: [
      "A task has exactly one assignee, because shared ownership is how work goes undone. A project has roles: who is Responsible, who is Accountable, who must be Consulted and who is merely Informed.",
      "They work together — project roles say who decides, task assignees say who does. A project task still has one name against it.",
    ],
    image: { src: "raci.jpg", caption: "Roles on the project, one assignee on each task." },
  },
  {
    id: "decisions",
    audience: "projects",
    question: "Why can I not close this decision?",
    answer: [
      "Only the named Approver can close a decision. Not the person who did the work, not a manager, not an administrator — sign-off cannot be delegated, escalated or overridden.",
      "If the named approver is unavailable, the decision waits or the approver is formally changed. Routing around it would make the record of who decided what worthless.",
    ],
    image: { src: "decide.jpg", caption: "The approver decides; nobody else can close it for them." },
  },

  // ---------------------------------------------------------- administrators
  {
    id: "cannot-get-in",
    audience: "administrators",
    question: "Somebody has a role but still cannot get into workPulse.",
    answer: [
      "Two gates have to line up, and only one of them is visible on this system. Their Synapse role must map to a workPulse role — Access shows which roles are reachable and which are not.",
      "The gate you cannot see here: the role must also carry the WorkPulse menu entry in Synapse, at the user's own hierarchy. Synapse matches the menu against the hierarchy of the person, while its admin screen writes it at the hierarchy of the role — so attaching the menu to a role at a different tier grants nothing and reports no error.",
      "That is why every member of staff holds EMPLOYEE as a baseline. Roles are a union, so anything else they hold only ever adds.",
    ],
    image: { src: "access.png", caption: "Role coverage: what is reachable, and what reaches nobody." },
  },
  {
    id: "access-stopped-after-deploy",
    audience: "administrators",
    question: "People who worked yesterday were refused after a deployment.",
    answer: [
      "Check the role mappings first. The deployment seed treats its own list as authoritative and deactivates every mapping not on it, so a mapping added through the Access screen disappears on the next deployment unless it was also added to the seed.",
      "The fix is to re-add the mapping and then add it to the seed as well, so it survives the next one. Nothing announces this when it happens, which is why it is worth checking before anything else.",
    ],
  },
  {
    id: "who-sees-what",
    audience: "administrators",
    question: "Why can I not open some screens even though I am an administrator?",
    answer: [
      "Being an administrator is not the same as having every permission. Some screens are deliberately closed to the role that configures the system — the flags view and the shadow quarter among them.",
      "That is the system working. A control the administrator can quietly read, alter or suppress is not much of a control, and an auditor will ask who could see what.",
    ],
  },
];
