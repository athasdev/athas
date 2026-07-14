import type { OutlineSymbol } from "../types/outline-symbol.types";

export function findSymbolPathAtPosition(
  symbols: OutlineSymbol[],
  line: number,
  character: number,
): OutlineSymbol[] {
  if (symbols.length === 0) return [];

  const containsPosition = (symbol: OutlineSymbol): boolean => {
    const afterStart =
      line > symbol.line || (line === symbol.line && character >= symbol.character);
    const beforeEnd =
      line < symbol.endLine || (line === symbol.endLine && character <= symbol.endCharacter);
    return afterStart && beforeEnd;
  };

  // symbols is a flat, depth-annotated, document-order list (see normalizeOutlineSymbols
  // in outline-symbols.ts). The deepest symbol whose range contains the position is the
  // innermost container.
  let deepest: OutlineSymbol | undefined;
  for (const symbol of symbols) {
    if (!containsPosition(symbol)) continue;
    if (!deepest || symbol.depth > deepest.depth) deepest = symbol;
  }
  if (!deepest) return [];

  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const chain: OutlineSymbol[] = [];
  let current: OutlineSymbol | undefined = deepest;
  while (current) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}
