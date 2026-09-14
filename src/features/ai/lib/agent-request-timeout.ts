export async function withAgentRequestTimeout<T>(
  request: Promise<T>,
  label: string,
  timeoutMs = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out. Please retry.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
