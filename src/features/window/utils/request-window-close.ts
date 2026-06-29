export const REQUEST_WINDOW_CLOSE_EVENT = "athas:request-window-close";

export function requestWindowClose() {
  window.dispatchEvent(new CustomEvent(REQUEST_WINDOW_CLOSE_EVENT));
}
