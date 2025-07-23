import { useCallback, useRef, useState } from "react";
import { useEventCallback } from "usehooks-ts";
import { getTokens, type Token } from "../lib/rust-api/tokens";

const DEBOUNCE_TIME_MS = 300;

export function useEditorDecorations() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchTokensCallback = useEventCallback(async (content: string, filePath: string) => {
    try {
      // Extract file extension from path
      const extension = filePath.split(".").pop() || "txt";
      const newTokens = await getTokens(content, extension);
      setTokens(newTokens);
    } catch (error) {
      console.error(error);
      setTokens([]);
    }
  });

  const fetchTokens = useCallback((content: string, filePath: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      fetchTokensCallback(content, filePath);
    }, DEBOUNCE_TIME_MS);
  }, []);

  return {
    tokens,
    fetchTokens,
  };
}
