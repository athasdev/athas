export function getAdminDataBufferPath(projectPath: string, sourceId?: string): string {
  return sourceId
    ? `admin-data://${encodeURIComponent(projectPath)}/${sourceId}`
    : `admin-data://create/${encodeURIComponent(projectPath)}`;
}
