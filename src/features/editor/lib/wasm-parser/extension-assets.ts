export interface LanguageAssetOverride {
  wasmPath?: string;
  highlightQueryUrl?: string;
}

export interface LanguageAssetConfig {
  languageId: string;
  parserLanguageId: string;
  queryLanguageId: string;
  wasmPath: string;
  highlightQueryUrl: string;
  highlightQueryCandidates: string[];
}

const QUERY_FOLDER_BY_LANGUAGE: Record<string, string> = {
  angular: "html",
  less: "css",
  sass: "css",
  scss: "css",
  javascript: "tsx",
  javascriptreact: "tsx",
  typescript: "tsx",
  typescriptreact: "tsx",
  mdx: "markdown",
  rmarkdown: "markdown",
  "jupyter-notebook": "json",
  csharp: "c_sharp",
  scheme: "elisp",
};

const PARSER_FOLDER_BY_LANGUAGE: Record<string, string> = {
  ...QUERY_FOLDER_BY_LANGUAGE,
  dotenv: "bash",
};

const runtimeAssetOverrides = new Map<string, LanguageAssetOverride>();

function getQueryFolder(languageId: string): string {
  return QUERY_FOLDER_BY_LANGUAGE[languageId] || languageId;
}

function getParserFolder(languageId: string): string {
  return PARSER_FOLDER_BY_LANGUAGE[languageId] || languageId;
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

export function registerLanguageAssetOverride(
  languageId: string,
  override: LanguageAssetOverride,
): void {
  runtimeAssetOverrides.set(languageId, override);
}

export function unregisterLanguageAssetOverride(languageId: string): void {
  runtimeAssetOverrides.delete(languageId);
}

export function getLanguageAssetConfig(languageId: string): LanguageAssetConfig {
  const parserLanguageId = getParserFolder(languageId);
  const queryLanguageId = getQueryFolder(languageId);
  const override = runtimeAssetOverrides.get(languageId);
  const wasmPath = override?.wasmPath || `/tree-sitter/parsers/${parserLanguageId}/parser.wasm`;
  const highlightQueryUrl =
    override?.highlightQueryUrl || `/tree-sitter/parsers/${queryLanguageId}/highlights.scm`;

  return {
    languageId,
    parserLanguageId,
    queryLanguageId,
    wasmPath,
    highlightQueryUrl,
    highlightQueryCandidates: getHighlightQueryCandidates(languageId, wasmPath, highlightQueryUrl),
  };
}

export function getDefaultParserWasmUrl(languageId: string): string {
  return getLanguageAssetConfig(languageId).wasmPath;
}

export function getHighlightQueryCandidates(
  languageId: string,
  wasmUrl?: string,
  preferredQueryUrl?: string,
): string[] {
  const queryFolder = getQueryFolder(languageId);
  const parserFolder = getParserFolder(languageId);
  const localQueryUrl = `/tree-sitter/parsers/${queryFolder}/highlights.scm`;
  const derivedQueryUrl = deriveHighlightQueryUrlFromWasm(wasmUrl);
  const overrideQueryUrl =
    preferredQueryUrl || runtimeAssetOverrides.get(languageId)?.highlightQueryUrl;
  const candidates =
    queryFolder === parserFolder
      ? [overrideQueryUrl, derivedQueryUrl, localQueryUrl]
      : [overrideQueryUrl, localQueryUrl, derivedQueryUrl];

  return Array.from(
    new Set(candidates.filter((candidate): candidate is string => Boolean(candidate))),
  );
}

export async function fetchHighlightQuery(
  languageId: string,
  options: { wasmUrl?: string; queryUrl?: string; cacheMode?: RequestCache } = {},
): Promise<{ query: string; sourceUrl: string | null }> {
  const { wasmUrl, queryUrl, cacheMode = "default" } = options;
  const candidates = getHighlightQueryCandidates(languageId, wasmUrl, queryUrl);

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
