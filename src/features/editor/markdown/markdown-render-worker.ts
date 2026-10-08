/// <reference lib="webworker" />

import type { MarkdownRenderRequest, MarkdownRenderResponse } from "./markdown-render-client";
import { renderMarkdown } from "./render-markdown";

self.addEventListener("message", (event: MessageEvent<MarkdownRenderRequest>) => {
  const { id, content, options } = event.data;
  let response: MarkdownRenderResponse;
  try {
    response = { id, ok: true, markdown: renderMarkdown(content, options) };
  } catch (error) {
    response = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  (self as DedicatedWorkerGlobalScope).postMessage(response);
});
