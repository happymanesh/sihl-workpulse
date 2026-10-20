/**
 * Fails when a document claims a different permission from the one the code
 * enforces.
 *
 * This exists because the manager guide told managers to create desk cards for
 * three days while the API refused them, and nothing noticed until somebody
 * asked. A guide that is merely written carefully drifts; one that is checked
 * cannot drift silently.
 *
 * Two things are checked, both against docs/authority.json, which is itself
 * read out of the router:
 *
 *   1. Each labelled section of the manager guide names the procedures it
 *      tells a reader to use. A section labelled for managers must not require
 *      a procedure that managers are refused.
 *   2. Each in-app help answer in a role-specific group does the same.
 *
 * Run with: npm run docs:check
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const authority = JSON.parse(fs.readFileSync(path.join(__dirname, "authority.json"), "utf8"));

const problems = [];
const checked = [];

/** The roles a procedure allows, or null if it is not in the router. */
function rolesFor(key) {
  const [area, proc] = key.split(".");
  return authority.routers[area]?.[proc]?.roles ?? null;
}

/** Does every one of these procedures admit a plain MANAGER? */
function managerMayDoAll(procs) {
  return procs.every((p) => {
    const roles = rolesFor(p);
    return roles && (roles.includes("MANAGER") || roles.includes("ANY_SIGNED_IN"));
  });
}

// ---------------------------------------------------------------------------
// 1. The manager guide
// ---------------------------------------------------------------------------
const guidePath = path.join(__dirname, "build-manager-guide.js");
const guide = fs.readFileSync(guidePath, "utf8");

// Each section is an object literal; the fields may be in any order, so match
// the section first and read the three fields out of it. Depending on field
// order is how this check quietly stopped matching the first time it was run.
const sectionRe = /\{\s*(?:[^{}]|\[[^\]]*\])*?title: "([^"]+)",(?:[^{}]|\[[^\]]*\])*?\}/g;

let m;
while ((m = sectionRe.exec(guide))) {
  const body = m[0];
  const title = m[1];
  const whoMatch = body.match(/who: "(head|manager)"/);
  const reqMatch = body.match(/requires: \[([^\]]*)\]/);
  if (!whoMatch || !reqMatch) continue; // Unlabelled sections are conceptual.
  const who = whoMatch[1];
  const rawProcs = reqMatch[1];
  const procs = rawProcs
    .split(",")
    .map((s) => s.trim().replace(/"/g, ""))
    .filter(Boolean);

  const unknown = procs.filter((p) => !rolesFor(p));
  if (unknown.length) {
    problems.push(
      `manager guide — "${title}" names ${unknown.join(", ")}, which no longer exists in the router. ` +
        `Either the procedure was renamed or the section is stale.`,
    );
    continue;
  }

  const managerCan = managerMayDoAll(procs);
  checked.push({ doc: "manager guide", title, who, procs, managerCan });

  if (who === "manager" && !managerCan) {
    const blocking = procs.filter((p) => !managerMayDoAll([p]));
    problems.push(
      `manager guide — "${title}" is labelled for managers, but ${blocking.join(", ")} ` +
        `allows only ${blocking.map((p) => rolesFor(p).join("/")).join("; ")}. ` +
        `Label it "head", or widen the permission deliberately.`,
    );
  }
  if (who === "head" && managerCan) {
    problems.push(
      `manager guide — "${title}" is labelled department-head-only, but a manager is allowed ` +
        `every procedure it names (${procs.join(", ")}). Managers are being told they cannot do ` +
        `something they can.`,
    );
  }
}

if (checked.length === 0) {
  problems.push(
    "manager guide — no labelled sections found at all. The check silently passing is worse " +
      "than the drift it looks for, so this counts as a failure.",
  );
}

// ---------------------------------------------------------------------------
// 2. The in-app help
// ---------------------------------------------------------------------------
const faqPath = path.join(ROOT, "apps", "web", "lib", "help-faqs.ts");
const faqs = fs.readFileSync(faqPath, "utf8");

const faqRe = /id: "([^"]+)",\s*\r?\n\s*audience: "([^"]+)",(?:[\s\S]{0,400}?requires: \[([^\]]*)\])?/g;
while ((m = faqRe.exec(faqs))) {
  const [, id, audience, rawProcs] = m;
  if (!rawProcs) continue; // Entries with nothing to verify are left alone.

  const procs = rawProcs
    .split(",")
    .map((s) => s.trim().replace(/"/g, ""))
    .filter(Boolean);

  const unknown = procs.filter((p) => !rolesFor(p));
  if (unknown.length) {
    problems.push(`help “${id}” names ${unknown.join(", ")}, which no longer exists in the router.`);
    continue;
  }

  const managerCan = managerMayDoAll(procs);
  checked.push({ doc: "in-app help", title: id, who: audience, procs, managerCan });

  if (audience === "managers" && !managerCan) {
    problems.push(
      `help “${id}” sits under “if you run a team's work”, but a manager is refused ` +
        `${procs.filter((p) => !managerMayDoAll([p])).join(", ")}. Move it to the governance group.`,
    );
  }
  if (audience === "governance" && managerCan) {
    problems.push(
      `help “${id}” is in the governance group, but a manager may do all of ${procs.join(", ")}. ` +
        `Move it back to the manager group.`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log(`checked ${checked.length} labelled sections against the router\n`);
for (const c of checked) {
  const verdict = c.who === "manager" || c.who === "managers" ? "managers" : "head/governance";
  console.log(`  ${c.doc.padEnd(13)} ${verdict.padEnd(16)} ${c.title}`);
}

if (problems.length) {
  console.error(`\n${problems.length} document(s) disagree with the code:\n`);
  for (const p of problems) console.error("  - " + p + "\n");
  console.error("Regenerate authority.json first (npm run docs:authority) in case the code moved.");
  process.exit(1);
}

console.log("\nevery labelled section agrees with the permission the code enforces");
