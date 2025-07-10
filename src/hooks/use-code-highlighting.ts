import Prism from "prismjs";
import { useCallback, useEffect, useRef } from "react";
import { useCodeEditorStore } from "../store/code-editor-store";

// Language detection based on file extension
const getLanguageFromFilename = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase();

  const languageMap: { [key: string]: string } = {
    rb: "ruby",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    java: "java",
    css: "css",
    scss: "css",
    sass: "css",
    json: "json",
    md: "markdown",
    markdown: "markdown",
    sh: "bash",
    bash: "bash",
    yml: "yaml",
    yaml: "yaml",
    sql: "sql",
    html: "markup",
    xml: "markup",
    php: "php",
    phtml: "php",
    php3: "php",
    php4: "php",
    php5: "php",
    php7: "php",
    cs: "csharp",
    rs: "rust",
    toml: "toml",
  };

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
    const debounceTime = isRemoteFile ? 300 : 16;

    highlightTimeoutRef.current = setTimeout(() => {
      const performHighlighting = () => {
        if (highlightRef.current && language !== "text") {
          try {
            const highlighted = safeHighlight(value, language);
            const withSearchHighlighting = addSearchHighlighting(highlighted);
            highlightRef.current.innerHTML = withSearchHighlighting;
          } catch (_error) {
            const escapedValue = escapeHtml(value);
            const withSearchHighlighting = addSearchHighlighting(escapedValue);
            highlightRef.current.innerHTML = withSearchHighlighting;
          }
        } else if (highlightRef.current) {
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
