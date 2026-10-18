"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { entriesForRoles } from "@/lib/nav";
import { trpc, type RouterOutputs } from "@/lib/trpc/client";

/**
 * Give one person a shorter menu.
 *
 * The screen is a list of everything their roles already grant, each with a
 * tick. Unticking hides it from their sidebar — and nothing else. The note at
 * the bottom says so plainly, because an administrator who believes this is a
 * permission will eventually use it as one.
 */
export function MenuEditor({ onError }: { onError: (message: string) => void }) {
  const utils = trpc.useUtils();
  const users = trpc.access.users.useQuery();
  const adjusted = trpc.access.adjustedMenus.useQuery();

  const [uid, setUid] = useState("");

  const selected = uid ? Number(uid) : null;
  const menu = trpc.access.menu.useQuery(
    { synapseUserUid: selected ?? 0 },
    { enabled: selected !== null },
  );

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5">
        <span className="label-caps">Menus</span>
      </div>

      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Person" htmlFor="menu-user" className="min-w-72 flex-1">
            <Select
              id="menu-user"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
            >
              <option value="">Choose somebody who has signed in…</option>
              {(users.data ?? []).map((u) => (
                <option key={u.synapseUserUid} value={u.synapseUserUid}>
                  {u.employee?.name ?? u.synapseUsername}
                  {u.employee?.department?.name ? ` — ${u.employee.department.name}` : ""} (
                  {u.synapseUsername})
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {selected !== null && menu.isLoading && (
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        )}

        {selected !== null && menu.data && (
          // Keyed on the person, so picking somebody else gives a form that
          // starts from THEIR list rather than one carrying the last edit.
          <PersonMenu
            key={menu.data.synapseUserUid}
            menu={menu.data}
            onSaved={() => {
              utils.access.menu.invalidate();
              utils.access.adjustedMenus.invalidate();
            }}
            onError={onError}
          />
        )}

        {(adjusted.data ?? []).length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="label-caps">People with a shortened menu</span>
            {(adjusted.data ?? []).map((u) => (
              <div key={u.synapseUserUid} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="font-medium">{u.employee?.name ?? u.synapseUsername}</span>
                <span className="text-2xs text-muted-foreground">
                  hidden: {u.hiddenNavKeys.join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 border-t border-border pt-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1.5 text-2xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">This is a tidier desk, not a permission.</span>{" "}
              Hiding a screen keeps it out of somebody&apos;s sidebar. It does not stop them opening
              it, and it changes nothing about what the API will hand them — their roles decide that,
              on every request, exactly as before.
            </p>
            <p>
              It only ever takes away. There is no way to show somebody an entry their roles do not
              grant, so a menu edit can never widen anybody&apos;s reach. If somebody genuinely
              should not reach a screen, change their role in Synapse — that is the control that is
              enforced.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type MenuData = RouterOutputs["access"]["menu"];

function PersonMenu({
  menu,
  onSaved,
  onError,
}: {
  menu: MenuData;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [hidden, setHidden] = useState<string[]>(menu.hiddenNavKeys);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);

  const save = trpc.access.setMenu.useMutation({
    onSuccess: () => {
      setSaved(true);
      onSaved();
    },
    onError: (e) => onError(e.message),
  });

  const entries = useMemo(() => entriesForRoles(menu.effectiveRoles), [menu.effectiveRoles]);

  const dirty =
    JSON.stringify([...hidden].sort()) !== JSON.stringify([...menu.hiddenNavKeys].sort());

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-2xs text-muted-foreground">Their roles:</span>
        {menu.effectiveRoles.map((r) => (
          <Badge key={r} tone="info">
            {r.replace(/_/g, " ").toLowerCase()}
          </Badge>
        ))}
        {menu.effectiveRoles.length === 0 && (
          <span className="text-2xs text-warning">
            No role maps to them, so they cannot sign in at all.
          </span>
        )}
      </div>

      <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {entries.map((entry) => {
          const isHidden = hidden.includes(entry.href);
          const locked = entry.href === "/tasks";
          return (
            <label
              key={entry.href}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={!isHidden}
                disabled={locked}
                onChange={() => {
                  setSaved(false);
                  setHidden((h) =>
                    isHidden ? h.filter((k) => k !== entry.href) : [...h, entry.href],
                  );
                }}
              />
              <entry.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className={isHidden ? "text-muted-foreground line-through" : undefined}>
                {entry.label}
              </span>
              {locked && <span className="text-2xs text-muted-foreground">always shown</span>}
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Reason" htmlFor="menu-reason" className="min-w-64 flex-1">
          <Input
            id="menu-reason"
            value={reason}
            placeholder="Why this person's menu differs"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              synapseUserUid: menu.synapseUserUid,
              hiddenNavKeys: hidden,
              reason: reason.trim() || undefined,
            })
          }
        >
          {save.isPending ? "Saving…" : "Save menu"}
        </Button>
        {saved && !dirty && <span className="text-2xs text-success">Saved</span>}
      </div>

      <p className="text-2xs text-muted-foreground">
        Takes effect the next time they load workPulse — they do not need to sign in again.
      </p>
    </>
  );
}
