const QUERY_FOLDER_BY_LANGUAGE: Record<string, string> = {
  javascript: "tsx",
  javascriptreact: "tsx",
  typescript: "tsx",
  typescriptreact: "tsx",
  mdx: "markdown",
  csharp: "c_sharp",
};

function getQueryFolder(languageId: string): string {
  return QUERY_FOLDER_BY_LANGUAGE[languageId] || languageId;
}

function deriveHighlightQueryUrlFromWasm(wasmUrl?: string): string | null {
  if (!wasmUrl) {
    return null;
  }

  const [withoutHash] = wasmUrl.split("#");
  const [withoutQuery, queryString] = withoutHash.split("?");

  if (!withoutQuery.endsWith("/parser.wasm")) {
    return null;
  }

  const base = withoutQuery.slice(0, -"/parser.wasm".length);
  return queryString ? `${base}/highlights.scm?${queryString}` : `${base}/highlights.scm`;
}

export function getDefaultParserWasmUrl(languageId: string): string {
  const folder = getQueryFolder(languageId);
  return `/tree-sitter/parsers/${folder}/parser.wasm`;
}

export function getHighlightQueryCandidates(languageId: string, wasmUrl?: string): string[] {
  const folder = getQueryFolder(languageId);
  const candidates = [
    deriveHighlightQueryUrlFromWasm(wasmUrl),
    `/tree-sitter/parsers/${folder}/highlights.scm`,
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.length > 0));

  return Array.from(new Set(candidates));
}

export async function fetchHighlightQuery(
  languageId: string,
  options: { wasmUrl?: string; cacheMode?: RequestCache } = {},
): Promise<{ query: string; sourceUrl: string | null }> {
  const { wasmUrl, cacheMode = "default" } = options;
  const candidates = getHighlightQueryCandidates(languageId, wasmUrl);

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: cacheMode });
      if (!response.ok) {
        continue;
      }

      const query = await response.text();
      if (query.trim().length === 0) {
        continue;
      }

      return { query, sourceUrl: candidate };
    } catch {}
  }

  return { query: "", sourceUrl: null };
}
