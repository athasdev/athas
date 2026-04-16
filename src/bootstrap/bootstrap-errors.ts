interface BootstrapStep {
  name: string;
}

export function logBootstrapError(step: string, error: unknown) {
  console.error(`App bootstrap failed during ${step}:`, error);
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
