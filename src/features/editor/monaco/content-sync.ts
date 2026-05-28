const MAX_PENDING_LOCAL_SNAPSHOTS = 8;

export function rememberLocalContentSnapshot(snapshots: string[], content: string): void {
  const existingIndex = snapshots.indexOf(content);
  if (existingIndex >= 0) {
    snapshots.splice(existingIndex, 1);
  }

  snapshots.push(content);

  while (snapshots.length > MAX_PENDING_LOCAL_SNAPSHOTS) {
    snapshots.shift();
  }
}

export function consumeLocalContentSnapshot(snapshots: string[], content: string): boolean {
  const index = snapshots.indexOf(content);
  if (index === -1) return false;

  snapshots.splice(index, 1);
  return true;
}
