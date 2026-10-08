/**
 * Content-free AI reliability signals. Payloads carry which provider, model and phase failed
 * and how, never prompts, file paths, messages or server error text.
 */
export const aiRunKinds = ["builtin", "acp", "codex"] as const;
export const aiFailurePhases = ["context", "provider", "stream", "empty_response"] as const;
export const aiEditSurfaces = ["inline_edit", "tab"] as const;
export const aiEditOutcomes = ["accept", "reject", "error"] as const;

export type AiRunKind = (typeof aiRunKinds)[number];
export type AiFailurePhase = (typeof aiFailurePhases)[number];
export type AiEditSurface = (typeof aiEditSurfaces)[number];
export type AiEditOutcome = (typeof aiEditOutcomes)[number];

export interface AiFailureInput {
  kind: AiRunKind;
  providerId: string;
  modelId?: string | null;
  /** A short machine code such as `http_429`, `offline` or `RECONNECT`; never free text. */
  code?: string | null;
  status?: number | null;
  phase: AiFailurePhase;
  stepCount?: number;
  retried?: boolean;
  cancelled?: boolean;
}

export interface AiEditOutcomeInput {
  surface: AiEditSurface;
  outcome: AiEditOutcome;
  providerId?: string | null;
  code?: string | null;
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,79}$/;
const CODE_PATTERN = /^[A-Za-z0-9_]{1,40}$/;

/** An identifier kept only when it looks like one, so free text can never slip through. */
function identifier(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && IDENTIFIER_PATTERN.test(trimmed) ? trimmed : null;
}

function code(value: string | null | undefined): string | null {
  return value && CODE_PATTERN.test(value) ? value : null;
}

export function createAiFailurePayload(input: AiFailureInput): Record<string, unknown> {
  return {
    kind: input.kind,
    provider_id: identifier(input.providerId),
    // A custom endpoint's model name is whatever the user typed; leave it out.
    model_id: input.providerId === "custom" ? null : identifier(input.modelId),
    code: code(input.code),
    status:
      typeof input.status === "number" && input.status >= 100 && input.status < 600
        ? Math.round(input.status)
        : null,
    phase: input.phase,
    step_count:
      input.stepCount !== undefined && Number.isFinite(input.stepCount)
        ? Math.min(99, Math.max(0, Math.round(input.stepCount)))
        : null,
    retried: input.retried === true,
    cancelled: input.cancelled === true,
  };
}

export function createAiEditOutcomePayload(input: AiEditOutcomeInput): Record<string, unknown> {
  return {
    surface: input.surface,
    outcome: input.outcome,
    provider_id: identifier(input.providerId),
    code: code(input.code),
  };
}
