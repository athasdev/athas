export function getApiErrorCode(message: string): string {
  return (
    message.match(/(?:error|status)(?: code)?:?\s*(\d{3})\b/i)?.[1] ??
    (/payment required/i.test(message)
      ? "402"
      : /unauthorized/i.test(message)
        ? "401"
        : /forbidden/i.test(message)
          ? "403"
          : "")
  );
}

export function formatApiError(providerId: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    const body =
      "responseBody" in error && typeof error.responseBody === "string"
        ? error.responseBody
        : message;
    return `${providerId} API error: ${error.statusCode}|||${body}`;
  }
  return `Failed to connect to ${providerId} API: ${message}`;
}
