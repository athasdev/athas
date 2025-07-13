import { Braces, Code, FileText, Hash, Type } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../utils/cn";

interface OutlineItem {
  name: string;
  type: "function" | "class" | "interface" | "method" | "property" | "header" | "section";
  line: number;
  level: number;
}

interface OutlineViewProps {
  content?: string;
  language?: string;
  onItemClick?: (line: number) => void;
  className?: string;
}

export default function OutlineView({
  content = "",
  language = "text",
  onItemClick,
  className = "",
}: OutlineViewProps) {
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);

  useEffect(() => {
    if (!content) {
      setOutlineItems([]);
      return;
    }

    const lines = content.split("\n");
    const items: OutlineItem[] = [];

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      const lineNumber = index + 1;

      if (language === "typescript" || language === "javascript") {
        if (trimmedLine.match(/^(export\s+)?(async\s+)?function\s+(\w+)/)) {
          const match = trimmedLine.match(/function\s+(\w+)/);
          if (match) {
            items.push({
              name: match[1],
              type: "function",
              line: lineNumber,
              level: 0,
            });
          }
        } else if (trimmedLine.match(/^(const|let|var)\s+(\w+)\s*=\s*(\([^)]*\))?\s*=>/)) {
          const match = trimmedLine.match(/(const|let|var)\s+(\w+)/);
          if (match) {
            items.push({
              name: match[2],
              type: "function",
              line: lineNumber,
              level: 0,
            });
          }
        } else if (trimmedLine.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)/)) {
          const match = trimmedLine.match(/class\s+(\w+)/);
          if (match) {
            items.push({
              name: match[1],
              type: "class",
              line: lineNumber,
              level: 0,
            });
          }
        } else if (trimmedLine.match(/^(export\s+)?interface\s+(\w+)/)) {
          const match = trimmedLine.match(/interface\s+(\w+)/);
          if (match) {
            items.push({
              name: match[1],
              type: "interface",
              line: lineNumber,
              level: 0,
            });
          }
        }
      } else if (language === "markdown") {
        const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
          items.push({
            name: headerMatch[2],
            type: "header",
            line: lineNumber,
            level: headerMatch[1].length - 1,
          });
        }
      }
    });

    setOutlineItems(items);
  }, [content, language]);

  const getIcon = (type: OutlineItem["type"]) => {
    switch (type) {
      case "function":
        return <Code size={12} className="text-blue-500" />;
      case "class":
        return <Braces size={12} className="text-green-500" />;
      case "interface":
        return <Type size={12} className="text-purple-500" />;
      case "method":
        return <Code size={12} className="text-blue-400" />;
      case "property":
        return <Hash size={12} className="text-yellow-500" />;
      case "header":
        return <Hash size={12} className="text-gray-500" />;
      default:
        return <FileText size={12} className="text-gray-400" />;
    }
  };

  const handleItemClick = (item: OutlineItem) => {
    if (onItemClick) {
      onItemClick(item.line);
    }
  };

  if (outlineItems.length === 0) {
    return (
      <div className={cn("flex h-full flex-col", className)}>
        <div className="border-border border-b p-3">
          <h3 className="font-medium font-mono text-text text-xs uppercase tracking-wide">
            Outline
          </h3>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center text-text-lighter">
            <FileText size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No outline available</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="border-border border-b p-3">
        <h3 className="font-medium font-mono text-text text-xs uppercase tracking-wide">Outline</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {outlineItems.map((item, index) => (
          <button
            key={index}
            onClick={() => handleItemClick(item)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-sm transition-colors hover:bg-hover"
            style={{ paddingLeft: `${12 + item.level * 16}px` }}
            title={`Line ${item.line}: ${item.name}`}
          >
            {getIcon(item.type)}
            <span className="flex-1 truncate text-text">{item.name}</span>
            <span className="text-text-lighter text-xs opacity-75">{item.line}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
