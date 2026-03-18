export function normalizeWebViewerUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  if (trimmed.match(/^https?:\/\//)) {
    return trimmed;
  }

  const isLocal =
    trimmed.toLowerCase().startsWith("localhost") ||
    trimmed.toLowerCase().startsWith("127.0.0.1");
  return isLocal ? `http://${trimmed}` : `https://${trimmed}`;
}

export function getWebViewerSecurity(url: string): {
  isLocalhost: boolean;
  isSecure: boolean;
  tooltip: string;
  toneClass: string;
} {
  const isSecure = url.startsWith("https://");
  const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1");

  return {
    isLocalhost,
    isSecure,
    tooltip: isLocalhost
      ? "Local development server"
      : isSecure
        ? "Secure connection (HTTPS)"
        : "Not secure (HTTP)",
    toneClass: isLocalhost ? "text-info" : isSecure ? "text-success" : "text-warning",
  };
}
