import { createContext, useContext, useEffect, useRef, useState } from "react";
import { DiffStats } from "@/features/ai/components/diff-stats";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { GitDiffIcon, ListChecksIcon, TerminalIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { useSessionPills } from "../hooks/use-session-pills";
import type { SessionPill } from "../services/session-pills";
import { setCardOrigin } from "../services/card-motion";
import { useSessionPanelStore } from "../stores/session-panel.store";

/** Where a session's pills go: floating beside the chat column, or in the session header. */
export const SessionPillsPlacementContext = createContext<"floating" | "header">("header");

export function useSessionPillsPlacement() {
  return useContext(SessionPillsPlacementContext);
}

const PILL_ORDER: SessionPill["id"][] = ["changes", "browser", "terminal", "plan"];
/** Matches `duration-fast`, so a pill stays until its exit transition ends. */
const EXIT_MS = 150;

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function describePill(pill: SessionPill): string {
  switch (pill.id) {
    case "changes":
      return `${pill.files} changed ${pill.files === 1 ? "file" : "files"}, +${pill.additions} −${pill.deletions}`;
    case "browser":
      return `${hostOf(pill.url)} is running`;
    case "terminal":
      return pill.state === "failed"
        ? "A command failed"
        : `Running ${pill.command ?? "a command"}`;
    case "plan":
      return `Plan: ${pill.done} of ${pill.total} done`;
  }
}

function PillContent({ pill }: { pill: SessionPill }) {
  switch (pill.id) {
    case "changes":
      return (
        <>
          <GitDiffIcon />
          <DiffStats additions={pill.additions} deletions={pill.deletions} />
        </>
      );
    case "browser":
      return (
        <>
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
          <span className="min-w-0 truncate">{hostOf(pill.url)}</span>
        </>
      );
    case "terminal":
      return pill.state === "failed" ? (
        <>
          <TerminalIcon />
          <Badge tone="danger">Failed</Badge>
        </>
      ) : (
        <>
          <Spinner compact />
          <span className="min-w-0 truncate font-mono">{pill.command}</span>
        </>
      );
    case "plan":
      return (
        <>
          <ListChecksIcon />
          <span className="tabular-nums">
            {pill.done}/{pill.total}
          </span>
        </>
      );
  }
}

/** Keeps a pill whose signal ended on screen while it fades out. */
function usePillPresence(pills: SessionPill[]) {
  const [leaving, setLeaving] = useState<SessionPill[]>([]);
  const previous = useRef(pills);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const gone = previous.current.filter((pill) => !pills.some((next) => next.id === pill.id));
    previous.current = pills;
    setLeaving((current) => {
      const kept = current.filter((pill) => !pills.some((next) => next.id === pill.id));
      return gone.length || kept.length !== current.length ? [...kept, ...gone] : current;
    });
    if (gone.length === 0) return;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setLeaving((current) => current.filter((pill) => !gone.includes(pill)));
    }, EXIT_MS);
    timers.current.add(timer);
  }, [pills]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  return [
    ...pills.map((pill) => ({ pill, leaving: false })),
    ...leaving.map((pill) => ({ pill, leaving: true })),
  ].sort((left, right) => PILL_ORDER.indexOf(left.pill.id) - PILL_ORDER.indexOf(right.pill.id));
}

/**
 * What a session with a collapsed tool card has going on: its changes, a live server, a failed or
 * running command and its plan. Each pill grows into the card on its tool.
 */
export function SessionSignalPills({
  chatId,
  placement,
}: {
  chatId: string;
  placement: "floating" | "header";
}) {
  const pills = usePillPresence(useSessionPills(chatId));
  const { open, requestFocus } = useSessionPanelStore.use.actions();
  if (pills.length === 0) return null;

  const items = pills.map(({ pill, leaving }) => {
    const label = describePill(pill);
    return (
      <span
        key={pill.id}
        data-pill={pill.id}
        data-leaving={leaving || undefined}
        className={cn(
          "flex max-w-36 transition-[opacity,translate] duration-fast ease-smooth starting:translate-x-1 starting:opacity-0 data-leaving:translate-x-1 data-leaving:opacity-0 motion-reduce:transition-none",
          leaving ? "pointer-events-none" : placement === "floating" && "pointer-events-auto",
        )}
      >
        <Button
          type="button"
          variant={placement === "floating" ? "outline" : "ghost"}
          size="sm"
          truncate
          tooltip={label}
          aria-label={label}
          tabIndex={leaving ? -1 : undefined}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setCardOrigin(chatId, {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            });
            if (pill.tab === "terminal") requestFocus(chatId, "terminal");
            open(chatId, pill.tab);
          }}
        >
          <PillContent pill={pill} />
        </Button>
      </span>
    );
  });

  if (placement === "header") return items;

  return (
    <div
      role="group"
      aria-label="Session signals"
      data-slot="session-signal-pills"
      className="pointer-events-none absolute top-pane-header right-2 z-10 mt-2 flex flex-col items-end gap-1.5"
    >
      {items}
    </div>
  );
}
