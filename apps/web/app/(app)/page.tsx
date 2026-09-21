import type { HealthStatus } from "@workpulse/shared-types";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

async function getApiHealth(): Promise<HealthStatus | { error: string }> {
  try {
    const res = await fetch(`${process.env.API_BASE_URL ?? "http://localhost:4000"}/health`, {
      cache: "no-store",
    });
    if (!res.ok) return { error: `API responded with ${res.status}` };
    return (await res.json()) as HealthStatus;
  } catch (err) {
    return { error: `Could not reach API: ${(err as Error).message}` };
  }
}

const TONE_FOR_STATUS = {
  ok: "success",
  degraded: "warning",
  down: "danger",
} as const;

function CheckRow({ label, state }: { label: string; state: "ok" | "error" }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-b-0">
      <span className="text-sm">{label}</span>
      <StatusDot
        tone={state === "ok" ? "success" : "danger"}
        label={state === "ok" ? "Connected" : "Unreachable"}
        className="text-xs text-muted-foreground"
      />
    </div>
  );
}

export default async function OverviewPage() {
  const health = await getApiHealth();
  const unreachable = "error" in health;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Service health</CardTitle>
          {unreachable ? (
            <Badge tone="danger">API unreachable</Badge>
          ) : (
            <Badge tone={TONE_FOR_STATUS[health.status]}>{health.status}</Badge>
          )}
        </CardHeader>

        <CardContent>
          {unreachable ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-danger">{health.error}</p>
              <p className="text-xs text-muted-foreground">
                Start the API and its infrastructure first, then reload. See{" "}
                <code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-2xs">
                  docs/phase-0-setup.md
                </code>
                .
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              <CheckRow label="Database" state={health.checks.database} />
              <CheckRow label="Redis" state={health.checks.redis} />
              <CheckRow label="Synapse directory" state={health.checks.synapse} />
            </div>
          )}
        </CardContent>

        {!unreachable && (
          <CardFooter>
            <span className="font-mono tabular">
              {health.service} · v{health.version} · checked {new Date(health.timestamp).toLocaleTimeString()}
            </span>
          </CardFooter>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        Phase 0 scaffold. This screen proves the stack is wired end to end; Phase 1 replaces it with the desk card
        and My Tasks views.
      </p>
    </div>
  );
}
