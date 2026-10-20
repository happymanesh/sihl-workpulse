/**
 * Exports who may perform every action in workPulse, by reading the API's own
 * router rather than by anybody writing a table from memory.
 *
 * This exists because "can a manager create a desk card" turned out to be a
 * question nobody could answer confidently from the documents, and the honest
 * answer (no - that is a department head) contradicted a guide. A matrix typed
 * by hand would drift again within a fortnight; one generated from
 * trpc.service.ts is wrong only if the code is wrong.
 *
 * Role constants are resolved from their declarations in the same file, so
 * widening MANAGEMENT_ROLES widens this automatically.
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "apps", "api", "src", "trpc", "trpc.service.ts");
const OUT = path.join(__dirname, "authority.json");

const src = fs.readFileSync(SRC, "utf8");

/** Resolve `const NAME = [ "A", "B" ] as const;` declarations. */
function roleConstants() {
  const consts = {};
  const re = /const\s+([A-Z_]+)\s*=\s*\[([^\]]*)\]\s*as const/g;
  let m;
  while ((m = re.exec(src))) {
    consts[m[1]] = m[2]
      .split(",")
      .map((s) => s.replace(/["'\s]/g, ""))
      .filter(Boolean);
  }
  return consts;
}

/** Expand a requireRoles(...) argument list into concrete role names. */
function expand(args, consts) {
  const roles = [];
  for (const raw of args.split(",")) {
    const token = raw.trim();
    if (!token) continue;
    if (token.startsWith("...")) {
      const name = token.slice(3).trim();
      if (!consts[name]) throw new Error(`Unknown role constant ${name} - has trpc.service.ts changed?`);
      roles.push(...consts[name]);
    } else {
      roles.push(token.replace(/["']/g, ""));
    }
  }
  return [...new Set(roles)];
}

/** Find each `name: router({ ... })` block and the procedures inside it. */
function routers() {
  const found = [];
  const re = /^ {6}([a-zA-Z]+): router\(\{/gm;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf("{", m.index + m[0].length - 1);
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    found.push({ name: m[1], block: src.slice(m.index, end) });
  }
  return found;
}

const consts = roleConstants();
const out = {};
let total = 0;

for (const r of routers()) {
  const procs = {};
  // Procedures sit one level in from the router, at eight spaces.
  const re = /^ {8}([a-zA-Z]+):\s*(requireRoles\(([^)]*)\)|protectedProcedure|publicProcedure)/gm;
  let m;
  while ((m = re.exec(r.block))) {
    let roles;
    if (m[2].startsWith("publicProcedure")) roles = ["PUBLIC"];
    else if (m[2].startsWith("protectedProcedure")) roles = ["ANY_SIGNED_IN"];
    else roles = expand(m[3], consts);

    // Whether it reads or writes, which is the distinction a reader of this
    // matrix actually cares about: seeing a thing and changing it are not the
    // same permission, and conflating them is how a table becomes misleading.
    const tail = r.block.slice(m.index, m.index + 1400);
    const q = tail.indexOf(".query(");
    const w = tail.indexOf(".mutation(");
    const kind = w !== -1 && (q === -1 || w < q) ? "change" : "view";

    procs[m[1]] = { roles, kind };
    total++;
  }
  if (Object.keys(procs).length) out[r.name] = procs;
}

fs.writeFileSync(OUT, JSON.stringify({ roleConstants: consts, routers: out }, null, 2));
console.log(`captured ${total} procedures across ${Object.keys(out).length} areas`);
for (const [name, list] of Object.entries(consts)) console.log(`  ${name} = ${list.join(", ")}`);
