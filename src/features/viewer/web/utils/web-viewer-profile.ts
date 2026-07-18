const GLOBAL_WEB_VIEWER_PROFILE_KEY = "global";

export function getWebViewerProfileKey(workspacePath?: string | null): string {
  const normalizedWorkspacePath = workspacePath?.trim();
  if (!normalizedWorkspacePath) return GLOBAL_WEB_VIEWER_PROFILE_KEY;
  return `workspace:${normalizedWorkspacePath}`;
}

export function getEmbeddedWebViewerUserAgent(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const userAgent = navigator.userAgent.trim();
  return userAgent.length > 0 ? userAgent : undefined;
}
