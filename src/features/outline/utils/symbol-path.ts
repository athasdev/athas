import type { OutlineSymbol } from "../types/outline-symbol.types";

interface IndexedSymbol {
  symbol: OutlineSymbol;
  originalIndex: number;
}

interface SymbolEndPosition {
  line: number;
  character: number;
}

interface SymbolPathIndex {
  symbolsByStart: IndexedSymbol[];
  prefixMaxEnd: SymbolEndPosition[];
  byId: Map<string, OutlineSymbol>;
}

const symbolPathIndexes = new WeakMap<OutlineSymbol[], SymbolPathIndex>();

function comparePositions(
  leftLine: number,
  leftCharacter: number,
  rightLine: number,
  rightCharacter: number,
): number {
  if (leftLine !== rightLine) return leftLine - rightLine;
  return leftCharacter - rightCharacter;
}

function createSymbolPathIndex(symbols: OutlineSymbol[]): SymbolPathIndex {
  const symbolsByStart = symbols
    .map((symbol, originalIndex) => ({ symbol, originalIndex }))
    .sort((left, right) => {
      const startComparison = comparePositions(
        left.symbol.line,
        left.symbol.character,
        right.symbol.line,
        right.symbol.character,
      );
      return startComparison || left.originalIndex - right.originalIndex;
    });
  const prefixMaxEnd: SymbolEndPosition[] = [];

  for (const { symbol } of symbolsByStart) {
    const previousMax = prefixMaxEnd[prefixMaxEnd.length - 1];
    if (
      !previousMax ||
      comparePositions(
        symbol.endLine,
        symbol.endCharacter,
        previousMax.line,
        previousMax.character,
      ) > 0
    ) {
      prefixMaxEnd.push({ line: symbol.endLine, character: symbol.endCharacter });
    } else {
      prefixMaxEnd.push(previousMax);
    }
  }

  return {
    symbolsByStart,
    prefixMaxEnd,
    byId: new Map(symbols.map((symbol) => [symbol.id, symbol])),
  };
}

function getSymbolPathIndex(symbols: OutlineSymbol[]): SymbolPathIndex {
  const cached = symbolPathIndexes.get(symbols);
  if (cached) return cached;

  const index = createSymbolPathIndex(symbols);
  symbolPathIndexes.set(symbols, index);
  return index;
}

function containsPosition(symbol: OutlineSymbol, line: number, character: number): boolean {
  return (
    comparePositions(line, character, symbol.line, symbol.character) >= 0 &&
    comparePositions(line, character, symbol.endLine, symbol.endCharacter) <= 0
  );
}

function findLastSymbolStartingBeforePosition(
  symbolsByStart: IndexedSymbol[],
  line: number,
  character: number,
): number {
  let low = 0;
  let high = symbolsByStart.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const symbol = symbolsByStart[middle].symbol;
    if (comparePositions(symbol.line, symbol.character, line, character) <= 0) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

export function findSymbolPathAtPosition(
  symbols: OutlineSymbol[],
  line: number,
  character: number,
): OutlineSymbol[] {
  if (symbols.length === 0) return [];

  const index = getSymbolPathIndex(symbols);
  let candidateIndex = findLastSymbolStartingBeforePosition(index.symbolsByStart, line, character);
  let deepest: IndexedSymbol | undefined;

  while (candidateIndex >= 0) {
    const candidate = index.symbolsByStart[candidateIndex];
    if (
      containsPosition(candidate.symbol, line, character) &&
      (!deepest ||
        candidate.symbol.depth > deepest.symbol.depth ||
        (candidate.symbol.depth === deepest.symbol.depth &&
          candidate.originalIndex < deepest.originalIndex))
    ) {
      deepest = candidate;
    }

    candidateIndex -= 1;
    const previousMaxEnd = index.prefixMaxEnd[candidateIndex];
    if (
      !previousMaxEnd ||
      comparePositions(previousMaxEnd.line, previousMaxEnd.character, line, character) < 0
    ) {
      break;
    }
  }

  if (!deepest) return [];

  const chain: OutlineSymbol[] = [];
  let current: OutlineSymbol | undefined = deepest.symbol;
  while (current) {
    chain.unshift(current);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return chain;
}
