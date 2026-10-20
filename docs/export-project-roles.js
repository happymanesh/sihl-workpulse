/**
 * Exports the roles each project procedure requires, by reading the API's own
 * router. Keeps the matrix in the project guide honest: if a procedure's roles
 * change, re-run this and rebuild the PDF rather than editing a table by hand.
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "apps", "api", "src", "trpc", "trpc.service.ts"), "utf8");
const start = src.indexOf("project: router({");
if (start === -1) throw new Error("project router not found - has trpc.service.ts been restructured?");

let i = src.indexOf("{", start);
let depth = 0;
let end = i;
for (; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") {
    depth--;
    if (depth === 0) { end = i; break; }
  }
}

const block = src.slice(start, end);
const re = /^\s{8}([a-zA-Z]+):\s*(requireRoles\(([^)]*)\)|protectedProcedure)/gm;
const out = {};
let m;
while ((m = re.exec(block))) {
  out[m[1]] = m[3] ? m[3].replace(/["'.]/g, "").split(",").map((s) => s.trim()).filter(Boolean) : ["ANY"];
}

fs.writeFileSync(path.join(__dirname, "project-roles.json"), JSON.stringify(out, null, 2));
console.log(`captured ${Object.keys(out).length} project procedures`);
