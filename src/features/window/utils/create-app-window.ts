import { invoke } from "@tauri-apps/api/core";
import type { WindowOpenRequest } from "@/features/window/utils/window-open-request";

interface CreateAppWindowPayload {
  request?: WindowOpenRequest | null;
}

export async function createAppWindow(request?: WindowOpenRequest | null) {
  return invoke<string>("create_app_window", {
    request: request ?? null,
  } satisfies CreateAppWindowPayload);
}
