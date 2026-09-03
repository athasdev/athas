export type ContinuousAgentCadence = "15m" | "hourly" | "4h" | "daily";

export interface ContinuousAgentCadenceOption {
  value: ContinuousAgentCadence;
  label: string;
  description: string;
  intervalMinutes: number;
}

export const CONTINUOUS_AGENT_CADENCES: ContinuousAgentCadenceOption[] = [
  {
    value: "15m",
    label: "15 min",
    description: "Fast feedback",
    intervalMinutes: 15,
  },
  {
    value: "hourly",
    label: "Hourly",
    description: "Steady progress",
    intervalMinutes: 60,
  },
  {
    value: "4h",
    label: "Every 4h",
    description: "A few times a day",
    intervalMinutes: 240,
  },
  {
    value: "daily",
    label: "Daily",
    description: "Daily upkeep",
    intervalMinutes: 1_440,
  },
];

const CADENCE_INTERVALS = new Map(
  CONTINUOUS_AGENT_CADENCES.map((cadence) => [cadence.value, cadence.intervalMinutes]),
);

export function isContinuousAgentCadence(value: unknown): value is ContinuousAgentCadence {
  return typeof value === "string" && CADENCE_INTERVALS.has(value as ContinuousAgentCadence);
}

export function getContinuousAgentCadence(value: ContinuousAgentCadence) {
  return (
    CONTINUOUS_AGENT_CADENCES.find((cadence) => cadence.value === value) ??
    CONTINUOUS_AGENT_CADENCES[1]
  );
}

export function getNextContinuousAgentRunAt(
  cadence: ContinuousAgentCadence,
  from = Date.now(),
): number {
  return from + getContinuousAgentCadence(cadence).intervalMinutes * 60_000;
}

export function formatContinuousAgentRunTime(timestamp: number, now = Date.now()): string {
  const remainingMs = timestamp - now;
  if (remainingMs <= 30_000) return "Ready now";

  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  if (remainingMinutes < 60) return `in ${remainingMinutes}m`;

  const remainingHours = Math.ceil(remainingMinutes / 60);
  if (remainingHours < 24) return `in ${remainingHours}h`;

  const remainingDays = Math.ceil(remainingHours / 24);
  return `in ${remainingDays}d`;
}
