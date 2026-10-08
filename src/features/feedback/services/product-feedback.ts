import { emitAppEvent } from "@/utils/app-events";

export function openProductFeedback() {
  emitAppEvent("athas:open-product-feedback");
}
