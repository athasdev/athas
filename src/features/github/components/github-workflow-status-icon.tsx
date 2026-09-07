import {
  CheckCircleIcon,
  CircleDotIcon,
  ClockIcon,
  type Icon,
  MinusCircleIcon,
  PauseIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import {
  getWorkflowRunState,
  type WorkflowRunPhase,
  type WorkflowRunTone,
} from "../utils/github-workflow-status";

const PHASE_ICONS: Record<Exclude<WorkflowRunPhase, "running">, Icon> = {
  success: CheckCircleIcon,
  failure: XCircleIcon,
  cancelled: MinusCircleIcon,
  skipped: MinusCircleIcon,
  "action-required": WarningCircleIcon,
  neutral: CircleDotIcon,
  queued: ClockIcon,
  waiting: PauseIcon,
  unknown: CircleDotIcon,
};

export const WORKFLOW_TONE_TEXT_CLASS: Record<WorkflowRunTone, string> = {
  success: "text-success",
  error: "text-destructive",
  warning: "text-warning",
  accent: "text-primary",
  muted: "text-subtle-foreground",
};

export const WORKFLOW_TONE_BADGE_VARIANT: Record<
  WorkflowRunTone,
  "success" | "error" | "warning" | "accent" | "muted"
> = {
  success: "success",
  error: "error",
  warning: "warning",
  accent: "accent",
  muted: "muted",
};

interface WorkflowStatusIconProps {
  status?: string | null;
  conclusion?: string | null;
  className?: string;
}

export function WorkflowStatusIcon({ status, conclusion, className }: WorkflowStatusIconProps) {
  const state = getWorkflowRunState(status, conclusion);
  const toneClass = WORKFLOW_TONE_TEXT_CLASS[state.tone];

  if (state.phase === "running") {
    return (
      <span
        role="img"
        aria-label={state.label}
        className={cn("inline-flex items-center justify-center", toneClass, className)}
      >
        <Spinner label={state.label} compact />
      </span>
    );
  }

  const PhaseIcon = PHASE_ICONS[state.phase];

  return (
    <PhaseIcon
      role="img"
      aria-label={state.label}
      optical="md"
      className={cn(toneClass, className)}
    />
  );
}
