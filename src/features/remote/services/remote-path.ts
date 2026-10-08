export function isRemotePath(path: string | undefined | null): path is string {
  return typeof path === "string" && path.startsWith("remote://");
}

export function parseRemotePath(path: string): { connectionId: string; remotePath: string } | null {
  const match = path.match(/^remote:\/\/([^/]+)(\/.*)?$/);
  if (!match) return null;

  return {
    connectionId: match[1],
    remotePath: match[2] || "/",
  };
}

export function buildRemoteRootPath(connectionId: string): string {
  return `remote://${connectionId}/`;
}
