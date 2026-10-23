import { execFileSync } from "node:child_process";

/**
 * Which commit this process is running, worked out once at startup.
 *
 * GIT_SHA first, for builds where the source is not present at runtime — a
 * container, or a tarball copied onto a host. Otherwise ask git, which works
 * because deployment here is a pull on the box, so the repository is sitting
 * right there.
 *
 * Never throws: a service that will not start because it could not name its
 * own commit is worse than one that says "unknown".
 *
 * Note it is captured at START, not at request time. A process left running
 * while the working copy moves on keeps reporting the commit it booted from —
 * which is the honest answer, because that is the code it is actually running.
 */
export const BUILD_REVISION: string = (() => {
  const fromEnv = process.env.GIT_SHA?.trim();
  if (fromEnv) return fromEnv.slice(0, 12);

  try {
    // execFileSync, not exec: no shell, so nothing here can be interpreted.
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return "unknown";
  }
})();

/** The package version. Not a build identifier — it has never changed. */
export const BUILD_VERSION: string = process.env.npm_package_version ?? "0.0.1";
