import { emitAppEvent } from "@/utils/app-events";

export function requestWindowClose() {
  emitAppEvent("window:request-close");
}
