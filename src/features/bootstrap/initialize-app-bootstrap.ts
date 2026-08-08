import { enableMapSet } from "immer";

let appBootstrapPromise: Promise<void> | null = null;

enableMapSet();

export function initializeAppBootstrap(): Promise<void> {
  if (appBootstrapPromise) {
    return appBootstrapPromise;
  }

  appBootstrapPromise = Promise.all([import("./bootstrap-sync"), import("./bootstrap-async")]).then(
    async ([{ runSynchronousBootstrapSteps }, { runAsyncBootstrapSteps }]) => {
      runSynchronousBootstrapSteps();
      await runAsyncBootstrapSteps();
    },
  );

  return appBootstrapPromise;
}
