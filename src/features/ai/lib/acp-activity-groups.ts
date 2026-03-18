import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";

export interface GroupedAcpActivity {
  running: ChatAcpEvent[];
  recent: ChatAcpEvent[];
  errors: ChatAcpEvent[];
  counts: {
    tools: number;
    permissions: number;
    errors: number;
  };
}

export function groupAcpActivity(events: ChatAcpEvent[]): GroupedAcpActivity {
  const deduped = dedupeEvents(events);
  const running = deduped.filter((event) => event.state === "running").slice(-4);
  const errors = deduped.filter((event) => event.state === "error").slice(-3);
  const recent = deduped
    .filter((event) => event.state !== "running")
    .slice(-6)
    .reverse();

  return {
    running,
    recent,
    errors,
    counts: {
      tools: deduped.filter((event) => event.kind === "tool").length,
      permissions: deduped.filter((event) => event.kind === "permission").length,
      errors: deduped.filter((event) => event.state === "error").length,
    },
  };
}

function dedupeEvents(events: ChatAcpEvent[]): ChatAcpEvent[] {
  const latestBySignature = new Map<string, ChatAcpEvent>();

  for (const event of events) {
    const signature = [event.kind, event.label, event.detail ?? "", event.state ?? ""].join("::");
    latestBySignature.set(signature, event);
  }

  return [...latestBySignature.values()].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
}
