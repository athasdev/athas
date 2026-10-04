export function isRemoteAuthFailure(error: unknown): boolean {
  const message = getRemoteErrorMessage(error).toLowerCase();

  if (isHostTrustError(message)) return false;

  return (
    message.includes("no valid authentication method") ||
    message.includes("authentication failed") ||
    message.includes("permission denied")
  );
}

function getRemoteErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isHostTrustError(message: string): boolean {
  return (
    message.startsWith("athas_ssh_unknown_host:") ||
    message.includes("ssh trusted hosts") ||
    message.includes("ssh server trust") ||
    message.includes("host key verification failed") ||
    message.includes("ssh server key changed")
  );
}

export function getFriendlyRemoteError(error: unknown): string {
  const rawError = getRemoteErrorMessage(error);
  const message = rawError.toLowerCase();

  if (isHostTrustError(message)) return rawError;

  if (message.includes("authentication failed") || message.includes("username/password")) {
    return "Incorrect username or password. Please try again.";
  }

  if (message.includes("permission denied")) {
    return "Permission denied. Check your credentials or SSH key configuration.";
  }

  if (message.includes("connection refused") || message.includes("actively refused")) {
    return "Connection refused. Check the host address and port.";
  }

  if (message.includes("no route to host") || message.includes("unreachable")) {
    return "Cannot reach the server. Check your network connection.";
  }

  if (message.includes("timed out") || message.includes("timeout")) {
    return "Connection timed out. The server may be unavailable.";
  }

  if (message.includes("connection not found")) {
    return "This remote session is no longer active. Reconnect and try again.";
  }

  return rawError || "Remote connection failed.";
}
