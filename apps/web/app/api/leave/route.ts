import { NextResponse } from "next/server";

/**
 * Leave workPulse and return to Synapse.
 *
 * Deliberately NOT a logout. The session cookie belongs to Synapse and is
 * shared across the origin, so clearing it here would sign the person out of
 * Synapse and every other app beside it - which is not what "sign out of
 * workPulse" should mean, and in production (separate domains) would not be
 * possible anyway.
 *
 * So this is a redirect, and the menu says as much rather than implying a
 * logout that did not happen.
 */
export function GET() {
  const synapse = process.env.SYNAPSE_BASE_URL ?? "http://localhost:3010";
  return NextResponse.redirect(synapse, { status: 303 });
}
