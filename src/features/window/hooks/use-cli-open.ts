import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { handleOpenRequest } from "@/utils/open-request";

interface CliOpenPayload {
  path: string;
  is_directory: boolean;
  line: number | null;
}

const getRequestKey = (payload: CliOpenPayload) => {
  return `${payload.path}:${payload.is_directory ? "directory" : "file"}:${payload.line ?? ""}`;
};

const processCliOpenPayload = async (payload: CliOpenPayload, handledRequests: Set<string>) => {
  const requestKey = getRequestKey(payload);
  if (handledRequests.has(requestKey)) {
    return;
  }

  handledRequests.add(requestKey);

  try {
    await handleOpenRequest({
      path: payload.path,
      isDirectory: payload.is_directory,
      line: payload.line ?? undefined,
    });
  } catch (error) {
    handledRequests.delete(requestKey);
    console.error("Failed to process CLI open request", error);
  }
};

export function useCliOpen() {
  useEffect(() => {
    const handledRequests = new Set<string>();

    invoke<CliOpenPayload[]>("get_startup_open_requests")
      .then(async (requests) => {
        for (const request of requests) {
          await processCliOpenPayload(request, handledRequests);
        }
      })
      .catch((error) => {
        console.error("Failed to load startup CLI open requests", error);
      });

    const unlisten = listen<CliOpenPayload>("cli_open_request", async (event) => {
      await processCliOpenPayload(event.payload, handledRequests);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
