export function getMongoDocumentDisplayIndex(
  currentPage: number,
  pageSize: number,
  pageIndex: number,
): number {
  const normalizedPage = Number.isFinite(currentPage) ? Math.max(1, Math.trunc(currentPage)) : 1;
  const normalizedPageSize = Number.isFinite(pageSize) ? Math.max(1, Math.trunc(pageSize)) : 1;
  const normalizedPageIndex = Number.isFinite(pageIndex) ? Math.max(0, Math.trunc(pageIndex)) : 0;

  return (normalizedPage - 1) * normalizedPageSize + normalizedPageIndex + 1;
}
