import Prism from "prismjs";
import { useCallback, useEffect, useRef } from "react";
import { useCodeEditorStore } from "../stores/code-editor-store";

// Enhanced language detection based on file extension
const getLanguageFromFilename = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase();

  const languageMap: { [key: string]: string } = {
    // JavaScript/TypeScript
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",

    // Python
    py: "python",
    pyw: "python",
    pyi: "python",

    // Ruby
    rb: "ruby",
    rbw: "ruby",
    rake: "ruby",

    // Java/JVM languages
    java: "java",
    scala: "scala",
    kt: "kotlin",

    // C/C++
    c: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    h: "c",
    hpp: "cpp",

    // CSS/Styling
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    stylus: "stylus",

    // Markup
    html: "markup",
    htm: "markup",
    xml: "markup",
    xhtml: "markup",
    svg: "markup",

    // Data formats
    json: "json",
    jsonc: "json",
    json5: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    ini: "ini",

    // Documentation
    md: "markdown",
    markdown: "markdown",
    mdx: "markdown",

    // Shell/Scripts
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    ps1: "powershell",

    // Web languages
    php: "php",
    phtml: "php",
    php3: "php",
    php4: "php",
    php5: "php",
    php7: "php",

    // Database
    sql: "sql",
    mysql: "sql",
    pgsql: "sql",

    // Systems languages
    rs: "rust",
    go: "go",
    cs: "csharp",
    fs: "fsharp",
    vb: "vbnet",

    // Functional languages
    hs: "haskell",
    elm: "elm",
    clj: "clojure",
    cljs: "clojure",

    // Config files
    dockerfile: "docker",
    "dockerfile.*": "docker",
    gitignore: "git",
    env: "bash",

    // Other
    r: "r",
    swift: "swift",
    dart: "dart",
  };

  // Special cases for files without extensions or special names
  const basename = filename.toLowerCase();
  if (basename === "dockerfile" || basename.startsWith("dockerfile.")) {
    return "docker";
  }
  if (basename === "makefile" || basename === "cmake") {
    return "makefile";
  }
  if (basename.startsWith(".env")) {
    return "bash";
  }

  return languageMap[ext || ""] || "text";
};

// Helper function to escape HTML entities
const escapeHtml = (text: string): string => {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
};

// Helper function to safely highlight code with proper HTML escaping
const safeHighlight = (code: string, language: string): string => {
  try {
    return Prism.highlight(code, Prism.languages[language] || Prism.languages.text, language);
  } catch (_error) {
    return escapeHtml(code);
  }
};

export const useCodeHighlighting = (highlightRef: React.RefObject<HTMLPreElement | null>) => {
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selective store subscriptions
  const value = useCodeEditorStore(state => state.value);
  const language = useCodeEditorStore(state => state.language);
  const filename = useCodeEditorStore(state => state.filename);
  const filePath = useCodeEditorStore(state => state.filePath);
  const searchQuery = useCodeEditorStore(state => state.searchQuery);
  const searchMatches = useCodeEditorStore(state => state.searchMatches);
  const currentMatchIndex = useCodeEditorStore(state => state.currentMatchIndex);
  const setLanguage = useCodeEditorStore(state => state.setLanguage);

  // Update language when filename changes
  useEffect(() => {
    if (filename) {
      const detectedLanguage = getLanguageFromFilename(filename);
      setLanguage(detectedLanguage);
    }
  }, [filename, setLanguage]);

  // Add search highlighting to already highlighted code
  const addSearchHighlighting = useCallback(
    (highlightedHtml: string) => {
      if (!searchQuery.trim() || searchMatches.length === 0) {
        return highlightedHtml;
      }

      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = highlightedHtml;

      searchMatches.forEach((match, index) => {
        const isCurrentMatch = index === currentMatchIndex;
        const className = isCurrentMatch ? "bg-yellow-400 text-black" : "bg-yellow-200 text-black";

        const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null);

        let node: Text | null;
        let accumulatedLength = 0;

        let currentNode = walker.nextNode() as Text;
        while (currentNode) {
          node = currentNode;
          const nodeLength = node.textContent?.length || 0;
          const nodeStart = accumulatedLength;
          const nodeEnd = accumulatedLength + nodeLength;

          if (match.start >= nodeStart && match.end <= nodeEnd) {
            const relativeStart = match.start - nodeStart;
            const relativeEnd = match.end - nodeStart;
            const beforeText = node.textContent?.substring(0, relativeStart) || "";
            const matchText = node.textContent?.substring(relativeStart, relativeEnd) || "";
            const afterText = node.textContent?.substring(relativeEnd) || "";

            const span = document.createElement("span");
            span.className = className;
            span.textContent = matchText;

            const parent = node.parentNode;
            if (parent) {
              if (beforeText) {
                parent.insertBefore(document.createTextNode(beforeText), node);
              }
              parent.insertBefore(span, node);
              if (afterText) {
                parent.insertBefore(document.createTextNode(afterText), node);
              }
              parent.removeChild(node);
            }
            break;
          }

          accumulatedLength += nodeLength;
          currentNode = walker.nextNode() as Text;
        }
      });

      return tempDiv.innerHTML;
    },
    [searchQuery, searchMatches, currentMatchIndex],
  );

  // Highlight code when value, language, or search changes
  useEffect(() => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }

    const isRemoteFile = filePath?.startsWith("remote://");
    const isLargeFile = value.length > 50000; // 50KB threshold
    const debounceTime = isRemoteFile ? 300 : isLargeFile ? 100 : 16;

    highlightTimeoutRef.current = setTimeout(() => {
      const performHighlighting = () => {
        if (!highlightRef.current) return;

        // For very large files, skip highlighting to maintain performance
        if (value.length > 100000) {
          // 100KB threshold
          const escapedValue = escapeHtml(value);
          const withSearchHighlighting = addSearchHighlighting(escapedValue);
          highlightRef.current.innerHTML = withSearchHighlighting;
          return;
        }

        if (language !== "text") {
          try {
            const highlighted = safeHighlight(value, language);
            const withSearchHighlighting = addSearchHighlighting(highlighted);
            highlightRef.current.innerHTML = withSearchHighlighting;
          } catch (_error) {
            console.warn(`Failed to highlight ${language}, falling back to plain text`);
            const escapedValue = escapeHtml(value);
            const withSearchHighlighting = addSearchHighlighting(escapedValue);
            highlightRef.current.innerHTML = withSearchHighlighting;
          }
        } else {
          const escapedValue = escapeHtml(value);
          const withSearchHighlighting = addSearchHighlighting(escapedValue);
          highlightRef.current.innerHTML = withSearchHighlighting;
        }
      };

      if (isRemoteFile && "requestIdleCallback" in window) {
        requestIdleCallback(performHighlighting, { timeout: 1000 });
      } else {
        performHighlighting();
      }
    }, debounceTime);

    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, [value, language, addSearchHighlighting, filePath, highlightRef]);

  return {
    getLanguageFromFilename,
    safeHighlight,
    addSearchHighlighting,
  };
};
