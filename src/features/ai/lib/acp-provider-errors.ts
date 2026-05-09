export interface AcpProviderErrorClassification {
  code: "AUTH_REQUIRED" | "PROVIDER_SETUP_REQUIRED";
  title: string;
  message: string;
  detail: string;
  activityLabel: string;
}

const SETUP_PATTERNS = [
  /\bno api key found\b/i,
  /\bmissing api key\b/i,
  /\bapi key.*required\b/i,
  /\benvironment variable\b/i,
  /\brun\s+[`"']?[\w.-]+(?:\s+[\w.:/@-]+)*\s+--setup[`"']?/i,
  /\bnot logged in\b/i,
  /\blogin required\b/i,
  /\bauthentication required\b/i,
];

const AUTHENTICATE_NOT_IMPLEMENTED = /method not implemented/i;

export function classifyAcpProviderError(
  mainError: string,
  errorDetails = "",
): AcpProviderErrorClassification | null {
  const text = [mainError, errorDetails].filter(Boolean).join("\n");

  if (!text) return null;

  if (text.includes("Authentication required")) {
    const detail = AUTHENTICATE_NOT_IMPLEMENTED.test(text)
      ? "This ACP adapter does not implement the protocol authenticate flow. Complete login in the underlying CLI/adapter, then try again."
      : errorDetails || "Complete authentication in the underlying CLI/adapter, then try again.";

    return {
      code: "AUTH_REQUIRED",
      title: "Authentication Required",
      message: "The selected agent needs external authentication before it can accept prompts.",
      detail,
      activityLabel: "Agent authentication required",
    };
  }

  if (!SETUP_PATTERNS.some((pattern) => pattern.test(text))) {
    return null;
  }

  return {
    code: "PROVIDER_SETUP_REQUIRED",
    title: "Provider Setup Required",
    message:
      "Athas launched the selected ACP provider, but the provider needs setup before it can answer.",
    detail: errorDetails || mainError,
    activityLabel: "Provider setup required",
  };
}
