import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { handleOpenRequest } from "@/utils/open-request";

interface CliOpenPayload {
  path: string;
  is_directory: boolean;
  line: number | null;
}

export function useCliOpen() {
  useEffect(() => {
    const unlisten = listen<CliOpenPayload>("cli_open_request", (event) => {
      const { path, is_directory, line } = event.payload;
      handleOpenRequest({
        path,
        isDirectory: is_directory,
        line: line ?? undefined,
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
