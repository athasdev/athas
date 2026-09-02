export interface AthasModelUriParts {
  scheme: "athas";
  authority: "editor";
  path: string;
  query: string;
}

export function createAthasModelUriParts(
  bufferId: string | undefined,
  filePath: string,
  displayPath = filePath,
): AthasModelUriParts {
  const sanitizedPath = displayPath.replace(/^\/+/, "");
  const path = sanitizedPath.length > 0 ? sanitizedPath : `${bufferId ?? "untitled"}.txt`;
  const query = new URLSearchParams();
  if (bufferId) query.set("buffer", bufferId);
  if (displayPath !== filePath) query.set("file", filePath);
  return {
    scheme: "athas",
    authority: "editor",
    path: `/${path}`,
    query: query.toString(),
  };
}

export function filePathFromAthasModelUri(path: string, query: string): string {
  const filePath = new URLSearchParams(query).get("file");
  if (filePath) return filePath;

  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {}
  if (/^\/[A-Za-z]:\//.test(decodedPath)) return decodedPath.slice(1);
  return decodedPath;
}
