import { type ForwardedRef, forwardRef, useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { type SemanticToken, TOKEN_TYPE_NAMES } from "./use-semantic-tokens";

interface SemanticTokensOverlayProps {
  tokens: SemanticToken[];
  content: string;
  fontSize: number;
  charWidth: number;
  scrollTop: number;
  viewportHeight: number;
}

const TOKEN_TYPE_COLORS: Record<string, string> = {
  namespace: "var(--syntax-type, #ffcb6b)",
  type: "var(--syntax-type, #ffcb6b)",
  class: "var(--syntax-type, #ffcb6b)",
  enum: "var(--syntax-type, #ffcb6b)",
  interface: "var(--syntax-type, #ffcb6b)",
  struct: "var(--syntax-type, #ffcb6b)",
  typeParameter: "var(--syntax-type, #ffcb6b)",
  parameter: "var(--syntax-variable, #f07178)",
  variable: "var(--syntax-variable, #f07178)",
  property: "var(--syntax-property, #82aaff)",
  enumMember: "var(--syntax-constant, #89ddff)",
  function: "var(--syntax-function, #82aaff)",
  method: "var(--syntax-function, #82aaff)",
  macro: "var(--syntax-function, #82aaff)",
  decorator: "var(--syntax-attribute, #c792ea)",
};

const SemanticTokensOverlay = forwardRef(
  (
    { tokens, content, fontSize, charWidth, scrollTop, viewportHeight }: SemanticTokensOverlayProps,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    const lineHeight = Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);

    const visibleTokens = useMemo(() => {
      const buffer = viewportHeight * 0.5;
      const startLine = Math.floor(Math.max(0, scrollTop - buffer) / lineHeight);
      const endLine = Math.ceil((scrollTop + viewportHeight + buffer) / lineHeight) + 1;

      return tokens.filter((t) => t.line >= startLine && t.line <= endLine);
    }, [tokens, scrollTop, viewportHeight, lineHeight]);

    const lines = useMemo(() => content.split("\n"), [content]);

    if (visibleTokens.length === 0) return null;

    return (
      <div
        ref={ref}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 3 }}
      >
        {visibleTokens.map((token) => {
          const typeName = TOKEN_TYPE_NAMES[token.tokenType];
          const color = typeName ? TOKEN_TYPE_COLORS[typeName] : undefined;

          if (!color) return null;

          const top = EDITOR_CONSTANTS.EDITOR_PADDING_TOP + token.line * lineHeight;
          const left = EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + token.startChar * charWidth;
          const width = token.length * charWidth;

          const lineContent = lines[token.line] || "";
          const tokenText = lineContent.slice(token.startChar, token.startChar + token.length);

          return (
            <span
              key={`${token.line}:${token.startChar}:${token.length}`}
              className="absolute editor-font"
              style={{
                top: `${top}px`,
                left: `${left}px`,
                width: `${width}px`,
                color,
                opacity: 0.95,
                fontSize: `${fontSize}px`,
                lineHeight: `${lineHeight}px`,
              }}
            >
              {tokenText}
            </span>
          );
        })}
      </div>
    );
  },
);

SemanticTokensOverlay.displayName = "SemanticTokensOverlay";

export default SemanticTokensOverlay;
