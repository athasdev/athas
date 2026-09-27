/**
 * Why an assistant turn failed, kept beside the message instead of inside its text so the
 * transcript can render it and the conversation history never sends it back to the model.
 */
export interface ChatMessageError {
  /** A server or client error code, such as `allowance_exhausted`, `http_429` or `offline`. */
  code?: string;
  /** The HTTP status the provider answered with, when there was one. */
  status?: number;
  message: string;
  /** Whether sending the same prompt again can succeed without changing anything. */
  retryable?: boolean;
}
