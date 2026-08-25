export function getViewBufferPath(projectPath: string, viewId?: string): string {
  return viewId
    ? `view://${encodeURIComponent(projectPath)}/${viewId}`
    : `view://create/${encodeURIComponent(projectPath)}`;
}
