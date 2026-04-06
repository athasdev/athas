import { extensionRegistry } from "@/extensions/registry/extension-registry";
import type { DatabaseType } from "@/features/database/models/provider.types";

/**
 * Get the programming language from a filename based on its extension
 */
export const getLanguageFromFilename = (filename: string): string => {
  const lowerFilename = filename.toLowerCase();
  const fromRegistry = extensionRegistry.getLanguageId(filename);
  if (fromRegistry === "ruby") {
    return "Ruby";
  }

  // Handle compound extensions like .html.erb
  if (lowerFilename.endsWith(".html.erb")) {
    return "ERB";
  }

  const ext = filename.split(".").pop()?.toLowerCase();
  const languageMap: { [key: string]: string } = {
    rb: "Ruby",
    js: "JavaScript",
    jsx: "JavaScript",
    ts: "TypeScript",
    tsx: "TypeScript",
    py: "Python",
    java: "Java",
    css: "CSS",
    scss: "SCSS",
    sass: "Sass",
    json: "JSON",
    md: "Markdown",
    markdown: "Markdown",
    sh: "Shell",
    bash: "Shell",
    yml: "YAML",
    yaml: "YAML",
    sql: "SQL",
    html: "HTML",
    xml: "XML",
    erb: "ERB",
    php: "PHP",
    phtml: "PHP",
    php3: "PHP",
    php4: "PHP",
    php5: "PHP",
    php7: "PHP",
    csharp: "C#",
    go: "Go",
    rs: "Rust",
    toml: "TOML",
  };
  return languageMap[ext || ""] || "Text";
};

/**
 * Check if a file is a SQLite database based on its extension
 */
export const isSQLiteFile = (path: string): boolean => {
  const lowerPath = path.toLowerCase();
  return (
    lowerPath.endsWith(".sqlite") || lowerPath.endsWith(".db") || lowerPath.endsWith(".sqlite3")
  );
};

/**
 * Check if a file is a DuckDB database based on its extension
 */
export const isDuckDBFile = (path: string): boolean => {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith(".duckdb") || lowerPath.endsWith(".duck");
};

/**
 * Get the database type from a file path, or null if not a database file
 */
export const getDatabaseTypeFromPath = (path: string): DatabaseType | null => {
  if (isSQLiteFile(path)) return "sqlite";
  if (isDuckDBFile(path)) return "duckdb";
  return null;
};

/**
 * Check if a file is an image based on its extension
 */
export const isImageFile = (path: string): boolean => {
  const lowerPath = path.toLowerCase();
  return (
    lowerPath.endsWith(".png") ||
    lowerPath.endsWith(".jpg") ||
    lowerPath.endsWith(".jpeg") ||
    lowerPath.endsWith(".gif") ||
    lowerPath.endsWith(".bmp") ||
    lowerPath.endsWith(".svg") ||
    lowerPath.endsWith(".webp") ||
    lowerPath.endsWith(".ico") ||
    lowerPath.endsWith(".tiff") ||
    lowerPath.endsWith(".tif") ||
    lowerPath.endsWith(".avif") ||
    lowerPath.endsWith(".heic") ||
    lowerPath.endsWith(".heif") ||
    lowerPath.endsWith(".jfif") ||
    lowerPath.endsWith(".pjpeg") ||
    lowerPath.endsWith(".pjp") ||
    lowerPath.endsWith(".apng")
  );
};

/**
 * Check if a file is a PDF based on its extension
 */
export const isPdfFile = (path: string): boolean => {
  return path.toLowerCase().endsWith(".pdf");
};

/**
 * Check if a file is a binary file that shouldn't be opened in the text editor
 */
export const isBinaryFile = (path: string): boolean => {
  const lowerPath = path.toLowerCase();
  const binarySuffixes = [
    ".tar.gz",
    ".tgz",
    ".tar.bz2",
    ".tbz2",
    ".tar.xz",
    ".txz",
    ".tar.zst",
    ".tzst",
  ];
  const binaryExtensions = [
    ".wasm",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".o",
    ".obj",
    ".a",
    ".lib",
    ".class",
    ".pyc",
    ".pyo",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".zip",
    ".tar",
    ".gz",
    ".bz2",
    ".xz",
    ".7z",
    ".rar",
    ".jar",
    ".war",
    ".ear",
    ".iso",
    ".dmg",
    ".msi",
  ];
  if (binarySuffixes.some((suffix) => lowerPath.endsWith(suffix))) {
    return true;
  }
  return binaryExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Best-effort binary sniffing for files with unknown extensions.
 * Treat null bytes and a high ratio of control bytes as unsupported for the text editor.
 */
export const isBinaryContent = (data: Uint8Array, sampleSize = 8192): boolean => {
  const limit = Math.min(data.length, sampleSize);
  if (limit === 0) return false;

  let suspiciousBytes = 0;

  for (let i = 0; i < limit; i++) {
    const byte = data[i];

    if (byte === 0) {
      return true;
    }

    const isPrintableAscii = byte >= 0x20 && byte <= 0x7e;
    const isCommonWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0c;
    const isLikelyUtf8Lead = byte >= 0xc2;

    if (!isPrintableAscii && !isCommonWhitespace && !isLikelyUtf8Lead) {
      suspiciousBytes++;
    }
  }

  return suspiciousBytes / limit > 0.3;
};

/**
 * Extract filename from a path
 */
export const getFilenameFromPath = (path: string): string => {
  return path.split("/").pop() || "Untitled";
};

/**
 * Get the directory path from a file path
 */
const getDirectoryFromPath = (filePath: string): string => {
  const pathParts = filePath.split("/");
  pathParts.pop(); // Remove the filename
  return pathParts.join("/");
};

/**
 * Get the root directory path from a list of files
 */
export const getRootPath = (files: any[]): string => {
  if (files.length === 0) return "";

  const firstFile = files[0];
  if (!firstFile?.path || typeof firstFile.path !== "string") return "";

  return getDirectoryFromPath(firstFile.path);
};
