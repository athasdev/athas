const DEFAULT_GIT_OPERATION_CONCURRENCY = 8;

export async function runGitFileOperationBatch(
  filePaths: string[],
  operation: (filePath: string) => Promise<boolean>,
  concurrency = DEFAULT_GIT_OPERATION_CONCURRENCY,
): Promise<Map<string, boolean>> {
  const uniqueFilePaths = [...new Set(filePaths)];
  const results = new Map<string, boolean>();
  const workerCount = Math.max(1, Math.min(concurrency, uniqueFilePaths.length));
  let cursor = 0;

  const worker = async () => {
    while (cursor < uniqueFilePaths.length) {
      const index = cursor;
      cursor += 1;
      const filePath = uniqueFilePaths[index];
      try {
        results.set(filePath, await operation(filePath));
      } catch {
        results.set(filePath, false);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
