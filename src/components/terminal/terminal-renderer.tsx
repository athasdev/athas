import type React from "react";
import { memo, useMemo } from "react";
import { colorToCSS } from "@/utils/terminal-colors";

interface LineItem {
  lexeme: string;
  width: number;
  is_underline: boolean;
  is_bold: boolean;
  is_italic: boolean;
  background_color?: any;
  foreground_color?: any;
}

interface TerminalRendererProps {
  screen: LineItem[][];
  cursorLine: number;
  cursorCol: number;
}

// Memoized line renderer with optimized comparison
const TerminalLine = memo(({ line, lineIndex }: { line: LineItem[]; lineIndex: number }) => {
  const lineContent = useMemo(() => {
    if (!line || line.length === 0) {
      return "\u00A0"; // Non-breaking space
    }

    // Fast path for empty lines
    if (line.every(item => !item.lexeme || item.lexeme === " ")) {
      return "\u00A0";
    }

    // Group consecutive items with the same styling to reduce DOM nodes
    const groups: Array<{ text: string; style: React.CSSProperties; className: string }> = [];
    let currentGroup: { text: string; style: React.CSSProperties; className: string } | null = null;

    for (const item of line) {
      const className = [
        item.is_bold && "font-bold",
        item.is_italic && "italic",
        item.is_underline && "underline",
      ]
        .filter(Boolean)
        .join(" ");

      const style: React.CSSProperties = {};
      let fgColor = colorToCSS(item.foreground_color);
      const bgColor = colorToCSS(item.background_color);

      // Apply enhanced colors if no color is set
      if (!fgColor) {
        const lexeme = item.lexeme || " ";

        // File extensions
        if (lexeme.match(/\.(js|jsx|ts|tsx|mjs|cjs)$/i)) {
          fgColor = "#f0db4f"; // JavaScript yellow
        } else if (lexeme.match(/\.(py|pyw|pyx)$/i)) {
          fgColor = "#3776ab"; // Python blue
        } else if (lexeme.match(/\.(rs|toml)$/i)) {
          fgColor = "#dea584"; // Rust orange
        } else if (lexeme.match(/\.(go|mod|sum)$/i)) {
          fgColor = "#00add8"; // Go cyan
        } else if (lexeme.match(/\.(json|jsonc)$/i)) {
          fgColor = "#cbcb41"; // JSON yellow
        } else if (lexeme.match(/\.(md|mdx)$/i)) {
          fgColor = "#083fa1"; // Markdown blue
        } else if (lexeme.match(/\.(css|scss|sass|less)$/i)) {
          fgColor = "#d63aff"; // CSS purple
        } else if (lexeme.match(/\.(html|htm|xml|svg)$/i)) {
          fgColor = "#e34c26"; // HTML red
        }

        // Directory indicators
        else if (
          lexeme.startsWith("drwx") ||
          lexeme.match(/\/$/) ||
          lexeme === "./" ||
          lexeme === "../"
        ) {
          fgColor = "#58a6ff"; // Directory blue
        }

        // Git status
        else if (lexeme.match(/^(\+|added|new file)/i)) {
          fgColor = "#3fb950"; // Git add green
        } else if (lexeme.match(/^(-|deleted|removed)/i)) {
          fgColor = "#f85149"; // Git delete red
        } else if (lexeme.match(/^(~|modified|changed)/i)) {
          fgColor = "#f0883e"; // Git modify orange
        }

        // Error/Warning/Success patterns
        else if (lexeme.match(/(error|ERROR|fail|FAIL|fatal|FATAL)/)) {
          fgColor = "#f85149"; // Error red
        } else if (lexeme.match(/(warning|WARNING|warn|WARN)/)) {
          fgColor = "#f0883e"; // Warning orange
        } else if (lexeme.match(/(success|SUCCESS|done|DONE|complete|COMPLETE|pass|PASS)/)) {
          fgColor = "#3fb950"; // Success green
        }

        // Command indicators
        else if (lexeme.match(/^(npm|yarn|pnpm|node|git|cargo|python|pip|go|make)\b/)) {
          fgColor = "#79c0ff"; // Command blue
        }
      }

      if (fgColor) style.color = fgColor;
      if (bgColor) style.backgroundColor = bgColor;

      const lexeme = item.lexeme || " ";

      // Check if we can merge with the current group
      if (
        currentGroup &&
        currentGroup.className === className &&
        JSON.stringify(currentGroup.style) === JSON.stringify(style)
      ) {
        currentGroup.text += lexeme;
      } else {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = { text: lexeme, style, className };
      }
    }

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }, [line]);

  if (typeof lineContent === "string") {
    return (
      <div key={lineIndex} className="h-[14px] whitespace-pre font-mono text-xs leading-[14px]">
        {lineContent}
      </div>
    );
  }

  return (
    <div key={lineIndex} className="h-[14px] whitespace-pre font-mono text-xs leading-[14px]">
      {lineContent.map((group, i) => (
        <span key={i} className={group.className} style={group.style}>
          {group.text}
        </span>
      ))}
    </div>
  );
});

TerminalLine.displayName = "TerminalLine";

// Main terminal renderer component
export const TerminalRenderer = ({ screen, cursorLine, cursorCol }: TerminalRendererProps) => {
  // Use canvas for cursor rendering to avoid constant DOM updates
  const cursorStyle = useMemo(
    () => ({
      position: "absolute" as const,
      left: `${cursorCol * 7.2}px`,
      top: `${cursorLine * 14}px`,
      width: "7.2px",
      height: "14px",
      backgroundColor: "#58a6ff",
      opacity: 0.8,
      animation: "blink 1s infinite",
      borderRadius: "1px",
    }),
    [cursorCol, cursorLine],
  );

  return (
    <div className="relative">
      {/* Render lines */}
      {screen.map((line, index) => (
        <TerminalLine key={index} line={line} lineIndex={index} />
      ))}

      {/* Cursor */}
      <div style={cursorStyle} />
    </div>
  );
};
