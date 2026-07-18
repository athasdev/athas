export const normalizeAcpWorkspacePath = (workspacePath: string | null | undefined) => {
  const trimmed = workspacePath?.trim();
  if (!trimmed) return null;

  const withForwardSlashes = trimmed.replace(/\\/g, "/");
  const normalized = /^[a-z]:\/+$/i.test(withForwardSlashes)
    ? withForwardSlashes.slice(0, 3)
    : withForwardSlashes.replace(/\/+$/, "");
  if (/^[a-z]:\//i.test(normalized) || trimmed.includes("\\")) {
    return normalized.toLowerCase();
  }

  return normalized || "/";
};
