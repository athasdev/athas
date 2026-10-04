// Preloaded by `bun test` (see e2e/run.ts): builds the app and starts
// tauri-driver once for every spec file in the run.
import { afterAll } from "bun:test";
import { startHarness, stopHarness } from "./driver.ts";

process.once("exit", stopHarness);

try {
  await startHarness();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

afterAll(stopHarness);
