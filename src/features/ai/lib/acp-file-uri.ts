export const getAcpPathBaseName = (path: string) => {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || path;
};

export const toAcpFileUri = (path: string) => {
  const normalized = path.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((segment, index) =>
      index === 0 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment),
    )
    .join("/");

  if (/^[a-z]:\//i.test(normalized)) {
    return `file:///${encoded}`;
  }
  if (normalized.startsWith("//")) {
    return `file:${encoded}`;
  }

  return `file://${encoded}`;
};
