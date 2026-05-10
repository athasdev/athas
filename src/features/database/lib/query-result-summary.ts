interface QueryResultSummaryInput {
  isCustomQuery: boolean;
  rowCount: number;
  currentPage?: number;
  totalPages?: number;
}

function rowNoun(count: number): string {
  return `row${count === 1 ? "" : "s"}`;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value ?? fallback));
}

function normalizeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function formatQueryResultSummary({
  isCustomQuery,
  rowCount,
  currentPage,
  totalPages,
}: QueryResultSummaryInput): string {
  const safeRowCount = normalizeNonNegativeInteger(rowCount);

  if (!isCustomQuery) {
    return `${safeRowCount} visible ${rowNoun(safeRowCount)}`;
  }

  const safeTotalPages = normalizePositiveInteger(totalPages, 1);
  if (safeTotalPages <= 1) {
    return `${safeRowCount} query ${rowNoun(safeRowCount)}`;
  }

  const safeCurrentPage = Math.min(normalizePositiveInteger(currentPage, 1), safeTotalPages);
  return `${safeRowCount} visible query ${rowNoun(safeRowCount)} on page ${safeCurrentPage} of ${safeTotalPages}`;
}
