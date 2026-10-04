/// <reference lib="webworker" />
import { executeSearchTask } from "./search-worker-execution";
import type { SearchWorkerRequest, SearchWorkerResponse } from "./search-worker-protocol";

self.addEventListener("message", (event: MessageEvent<SearchWorkerRequest>) => {
  const { id, task } = event.data;
  let response: SearchWorkerResponse;
  try {
    response = { id, result: executeSearchTask(task) };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
});
