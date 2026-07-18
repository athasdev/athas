import { runAsyncBootstrapSteps } from "./bootstrap-async";
import { runSynchronousBootstrapSteps } from "./bootstrap-sync";

let appBootstrapPromise: Promise<void> | null = null;

export function initializeAppBootstrap(): Promise<void> {
  if (appBootstrapPromise) {
    return appBootstrapPromise;
  }

  runSynchronousBootstrapSteps();
  appBootstrapPromise = runAsyncBootstrapSteps();

  return appBootstrapPromise;
}
