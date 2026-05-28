function stringifyDatabaseError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return String(error);
}

export function normalizeDatabaseError(error: unknown): string {
  const message = stringifyDatabaseError(error)
    .replace(/^Error:\s*/i, "")
    .replace(/\s*note:\s*run with `RUST_BACKTRACE=1`.*$/is, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!message) return "Unknown database error";

  const sidecarPanicMatch = message.match(/^Database sidecar panic:\s*(.+)$/i);
  if (sidecarPanicMatch) {
    return `The database provider crashed while handling this request: ${sidecarPanicMatch[1]}`;
  }

  if (/^Unsupported database sidecar protocol version(?: for provider .+)?:/i.test(message)) {
    return "The database provider version is not compatible with this Athas build. Please update or reinstall the database extension.";
  }

  if (/^Invalid database sidecar (response|envelope):/i.test(message)) {
    return "The database provider returned an invalid response. Please update or reinstall the database extension.";
  }

  if (/^Database sidecar response was missing (protocolVersion|result)$/i.test(message)) {
    return "The database provider returned an incomplete response. Please update or reinstall the database extension.";
  }

  if (/^Database sidecar returned an unknown error$/i.test(message)) {
    return "The database provider returned an incomplete error response. Please update or reinstall the database extension.";
  }

  if (/^Database sidecar timed out after \d+ seconds$/i.test(message)) {
    return "The database provider timed out while handling this request. Please retry or narrow the query.";
  }

  if (/thread '.*' .*panicked at/i.test(message)) {
    if (/statement was not executed yet/i.test(message)) {
      return "The database provider failed while reading the query result. Please retry the query or reopen the database.";
    }
    return "The database provider crashed while handling this request.";
  }

  return message;
}

export function formatDatabaseError(context: string, error: unknown): string {
  return `${context}: ${normalizeDatabaseError(error)}`;
}
