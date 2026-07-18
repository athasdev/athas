import type { OutlineSymbol } from "../types/outline-symbol.types";

export interface RawOutlineSymbol {
  name: string;
  kind: string;
  detail?: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  containerName?: string;
  hierarchyPath?: number[];
}

function startsBeforeOrAt(a: RawOutlineSymbol, b: RawOutlineSymbol): boolean {
  return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

function endsAfterOrAt(a: RawOutlineSymbol, b: RawOutlineSymbol): boolean {
  return a.endLine > b.endLine || (a.endLine === b.endLine && a.endCharacter >= b.endCharacter);
}

function containsSymbol(parent: RawOutlineSymbol, child: RawOutlineSymbol): boolean {
  if (parent === child) return false;
  return startsBeforeOrAt(parent, child) && endsAfterOrAt(parent, child);
}

export function normalizeOutlineSymbols(
  symbols: RawOutlineSymbol[],
  filePath: string,
): OutlineSymbol[] {
  if (symbols.some((symbol) => symbol.hierarchyPath && symbol.hierarchyPath.length > 0)) {
    return normalizeHierarchicalOutlineSymbols(symbols, filePath);
  }

  const sortedSymbols = [...symbols].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.character !== b.character) return a.character - b.character;
    if (a.endLine !== b.endLine) return b.endLine - a.endLine;
    return b.endCharacter - a.endCharacter;
  });
  const stack: { raw: RawOutlineSymbol; symbol: OutlineSymbol }[] = [];
  const normalizedSymbols: OutlineSymbol[] = [];

  sortedSymbols.forEach((symbol, index) => {
    while (stack.length > 0) {
      const parent = stack[stack.length - 1]?.raw;
      if (parent && containsSymbol(parent, symbol)) break;
      stack.pop();
    }

    const parent = stack[stack.length - 1]?.symbol;
    const normalizedSymbol: OutlineSymbol = {
      ...symbol,
      id: `${filePath}:${symbol.line}:${symbol.character}:${symbol.kind}:${symbol.name}:${index}`,
      filePath,
      depth: stack.length,
      parentId: parent?.id,
      childCount: 0,
      isLastChild: true,
    };

    if (parent) {
      parent.childCount += 1;
      for (let siblingIndex = normalizedSymbols.length - 1; siblingIndex >= 0; siblingIndex -= 1) {
        const previousSibling = normalizedSymbols[siblingIndex];
        if (previousSibling?.parentId !== parent.id) continue;
        previousSibling.isLastChild = false;
        break;
      }
    }

    normalizedSymbols.push(normalizedSymbol);
    stack.push({ raw: symbol, symbol: normalizedSymbol });
  });

  return normalizedSymbols;
}

function getHierarchyKey(path: number[]): string {
  return path.join(".");
}

function normalizeHierarchicalOutlineSymbols(
  symbols: RawOutlineSymbol[],
  filePath: string,
): OutlineSymbol[] {
  const normalizedSymbols: OutlineSymbol[] = [];
  const symbolByHierarchyKey = new Map<string, OutlineSymbol>();

  symbols.forEach((symbol, index) => {
    const hierarchyPath = symbol.hierarchyPath ?? [];
    const parentPath = hierarchyPath.slice(0, -1);
    const parent =
      parentPath.length > 0 ? symbolByHierarchyKey.get(getHierarchyKey(parentPath)) : undefined;
    const normalizedSymbol: OutlineSymbol = {
      ...symbol,
      id: `${filePath}:${getHierarchyKey(hierarchyPath)}:${symbol.kind}:${symbol.name}:${index}`,
      filePath,
      depth: Math.max(0, hierarchyPath.length - 1),
      parentId: parent?.id,
      childCount: 0,
      isLastChild: true,
    };

    if (parent) {
      parent.childCount += 1;
      for (let siblingIndex = normalizedSymbols.length - 1; siblingIndex >= 0; siblingIndex -= 1) {
        const previousSibling = normalizedSymbols[siblingIndex];
        if (previousSibling?.parentId !== parent.id) continue;
        previousSibling.isLastChild = false;
        break;
      }
    }

    normalizedSymbols.push(normalizedSymbol);
    if (hierarchyPath.length > 0) {
      symbolByHierarchyKey.set(getHierarchyKey(hierarchyPath), normalizedSymbol);
    }
  });

  return normalizedSymbols;
}

export function filterOutlineSymbols(symbols: OutlineSymbol[], query: string): OutlineSymbol[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return symbols;

  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const includedIds = new Set<string>();

  symbols.forEach((symbol) => {
    const haystack = [
      symbol.name,
      symbol.kind,
      symbol.detail ?? "",
      symbol.containerName ?? "",
      `${symbol.line + 1}`,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(normalizedQuery)) return;

    let currentSymbol: OutlineSymbol | undefined = symbol;
    while (currentSymbol) {
      includedIds.add(currentSymbol.id);
      currentSymbol = currentSymbol.parentId ? symbolById.get(currentSymbol.parentId) : undefined;
    }
  });

  return symbols.filter((symbol) => includedIds.has(symbol.id));
}

export function getVisibleOutlineSymbols(
  symbols: OutlineSymbol[],
  collapsedIds: Set<string>,
  query: string,
): OutlineSymbol[] {
  const filteredSymbols = filterOutlineSymbols(symbols, query);
  if (query.trim()) return filteredSymbols;

  const hiddenParentIds = new Set<string>();
  const visibleSymbols: OutlineSymbol[] = [];

  for (const symbol of filteredSymbols) {
    if (symbol.parentId && hiddenParentIds.has(symbol.parentId)) {
      hiddenParentIds.add(symbol.id);
      continue;
    }

    visibleSymbols.push(symbol);

    if (collapsedIds.has(symbol.id)) {
      hiddenParentIds.add(symbol.id);
    }
  }

  return visibleSymbols;
}

export function getOutlineSymbolNavigationDetail(
  symbol: Pick<OutlineSymbol, "filePath" | "line" | "character">,
) {
  return {
    path: symbol.filePath,
    line: symbol.line + 1,
    column: symbol.character + 1,
  };
}

export function openOutlineSymbol(symbol: Pick<OutlineSymbol, "filePath" | "line" | "character">) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("menu-go-to-line", {
      detail: getOutlineSymbolNavigationDetail(symbol),
    }),
  );
}
