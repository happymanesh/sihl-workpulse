/**
 * Whether a nav href is "active" for the current path.
 *
 * A plain `pathname.startsWith(href)` is wrong: "/desk-cards" starts with
 * "/desk-card", so browsing the admin list would light up "My desk card" too.
 * The match has to land on a path-segment boundary.
 *
 * "/" is special-cased to exact, or it matches everything.
 */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
