export function getSelectedSqlText(value: string, selectionStart: number, selectionEnd: number) {
  const start = normalizeSelectionOffset(selectionStart, value.length);
  const end = normalizeSelectionOffset(selectionEnd, value.length);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  return value.slice(from, to).trim();
}

function normalizeSelectionOffset(offset: number, textLength: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(Math.trunc(offset), textLength));
}
