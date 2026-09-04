import type { TelemetryLogEntry } from "@/features/telemetry/services/telemetry";

export interface FeedbackDraft {
  intent: string;
  actual: string;
  expected: string;
}

export interface FeedbackEnvironment {
  appVersion: string;
  os: string;
  frictionSignals: Array<{ name: string; count: number }>;
}

const MAX_FIELD_LENGTH = 1_200;

function normalizeField(value: string) {
  return value.trim().slice(0, MAX_FIELD_LENGTH);
}

export function aggregateFrictionSignals(entries: TelemetryLogEntry[]) {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.eventType.startsWith("friction:")) continue;
    counts.set(entry.eventType, (counts.get(entry.eventType) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildFeedbackIssueBody(draft: FeedbackDraft, environment?: FeedbackEnvironment) {
  const sections = [
    `## Intent\n\n${normalizeField(draft.intent)}`,
    `## What happened\n\n${normalizeField(draft.actual)}`,
    `## What I expected\n\n${normalizeField(draft.expected)}`,
  ];

  if (environment) {
    const signals = environment.frictionSignals.length
      ? environment.frictionSignals.map(({ name, count }) => `- ${name}: ${count}`).join("\n")
      : "- None recorded";

    sections.push(
      `## Sanitized environment\n\n- App: Athas ${environment.appVersion}\n- OS: ${environment.os}\n\nRecent content-free friction signals:\n${signals}`,
    );
  }

  return `${sections.join("\n\n")}\n`;
}

export function buildFeedbackIssueUrl(draft: FeedbackDraft, environment?: FeedbackEnvironment) {
  const titleText = normalizeField(draft.intent).split("\n")[0] || "Product feedback";
  const params = new URLSearchParams({
    title: `Feedback: ${titleText.slice(0, 80)}`,
    body: buildFeedbackIssueBody(draft, environment),
  });

  return `https://github.com/athasdev/athas/issues/new?${params.toString()}`;
}
