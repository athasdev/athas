import { emitAppEvent } from "@/utils/app-events";

export function requestWindowClose() {
  emitAppEvent("athas:request-window-close");
}
