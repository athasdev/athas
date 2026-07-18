import { recordCrashReport } from "@/features/telemetry/services/telemetry";

interface BootstrapStep {
  name: string;
}

export function logBootstrapError(step: string, error: unknown) {
  console.error(`App bootstrap failed during ${step}:`, error);
  void recordCrashReport({
    kind: "bootstrap_error",
    step,
    ...(error instanceof Error
      ? {
          message: error.message,
          stack: error.stack || null,
        }
      : {
          message: String(error),
        }),
  });
}

export function reportBootstrapResults(
  steps: readonly BootstrapStep[],
  results: readonly PromiseSettledResult<unknown>[],
) {
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logBootstrapError(steps[index]?.name ?? "unknown step", result.reason);
    }
  });
}
