import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { extensionManager } from "../extensions/manager";

/**
 * Detect programming language from file extension using the extension registry
 */
export function detectLanguageFromPath(filePath: string): string {
  const fromRegistry = extensionRegistry.getLanguageId(filePath);
  if (fromRegistry) {
    return fromRegistry;
  }

  const extension = filePath.toLowerCase().split(".").pop() || "";

  // First, try to get language from extension manager
  const languageProvider = extensionManager.getLanguageProvider(extension);
  if (languageProvider) {
    return languageProvider.id;
  }

  // Fallback to static map for unsupported languages
  const languageMap: Record<string, string> = {
    // Unsupported languages that might be added in the future
    scss: "scss",
    sass: "sass",
    less: "less",
    xml: "xml",
    svg: "xml",
    rst: "restructuredtext",
    tex: "latex",
    scala: "scala",
    hs: "haskell",
    ml: "ocaml",
    fs: "fsharp",
    clj: "clojure",
    lisp: "lisp",
    scm: "scheme",
    fish: "shell",
    ps1: "powershell",
    bat: "batch",
    cmd: "batch",
    ini: "ini",
    cfg: "ini",
    conf: "ini",
    csv: "csv",
    dockerfile: "dockerfile",
    makefile: "makefile",
    r: "r",
    lua: "lua",
    vim: "vim",
    elm: "elm",
  };

  return languageMap[extension] || "text";
}

/**
 * Detect language from file name (handles special cases like Dockerfile, Makefile)
 */
export function detectLanguageFromFileName(fileName: string): string {
  const lowercaseName = fileName.toLowerCase();

  // Special files without extensions
  if (lowercaseName === "dockerfile" || lowercaseName.startsWith("dockerfile.")) {
    return "dockerfile";
  }

  if (lowercaseName === "makefile" || lowercaseName.startsWith("makefile.")) {
    return "makefile";
  }

  if (lowercaseName === "cmakelists.txt") {
    return "cmake";
  }

  if (lowercaseName === ".gitignore" || lowercaseName === ".dockerignore") {
    return "gitignore";
  }

  return detectLanguageFromPath(fileName);
}
