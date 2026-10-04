import type { ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";

/**
 * Writes a child's stdout and stderr to one file. Both streams are piped with
 * `end: false` because whichever closes first would otherwise end the file
 * while the other is still writing; the file closes with the process instead.
 */
export function logProcessOutput(child: ChildProcess, filePath: string) {
  const log = createWriteStream(filePath);
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.once("close", () => log.end());
  child.once("error", () => log.end());
}
