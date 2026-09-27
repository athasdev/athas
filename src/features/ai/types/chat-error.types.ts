/**
 * What the user can do about a failed turn. When an error lists none, they follow from its
 * code: agent setup codes offer to restart the agent or open its terminal, anything else offers
 * provider recovery and, when the error is retryable, a retry.
 */
export type ChatErrorAction =
  /** Send the prompt again. */
  | "retry"
  /** Sign in, fix billing, add a key or open model settings, whichever fits the code. */
  | "provider_settings"
  /** Restart the agent's session after the user fixed its setup. */
  | "restart_agent"
  /** Open a terminal running the agent's login or setup command. */
  | "open_agent_terminal";

/**
 * Why an assistant turn failed, kept beside the message instead of inside its text so the
 * transcript can render it and the conversation history never sends it back to the model.
 */
export interface ChatMessageError {
  /** A server or client error code, such as `allowance_exhausted`, `auth_required` or `offline`. */
  code?: string;
  /** The HTTP status the provider answered with, when there was one. */
  status?: number;
  /** A short headline; the message is used when there is none. */
  title?: string;
  message: string;
  /** Raw detail, such as a response body, shown on request. */
  details?: string;
  /** The provider that failed, when it is not the chat's own. */
  providerId?: string;
  /** Whether sending the same prompt again can succeed without changing anything. */
  retryable?: boolean;
  actions?: ChatErrorAction[];
}
