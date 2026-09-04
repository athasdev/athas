export const OPEN_PRODUCT_FEEDBACK_EVENT = "athas:open-product-feedback";

export function openProductFeedback() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PRODUCT_FEEDBACK_EVENT));
}
