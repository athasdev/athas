import { type CSSProperties, memo } from "react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import type { SearchMatch } from "@/features/global-search/lib/rust-api/search";
import { Button } from "@/ui/button";

interface SearchMatchItemProps {
  filePath: string;
  displayPath: string;
  match: SearchMatch;
  index: number;
  isSelected: boolean;
  onSelect: (filePath: string, lineNumber: number) => void;
  onPreview?: (filePath: string) => void;
  style?: CSSProperties;
}

const highlightMatch = (text: string, start: number, end: number) => {
  const before = text.slice(0, start);
  const matchText = text.slice(start, end);
  const after = text.slice(end);

  return (
    <>
      {before}
      <span className="bg-accent/30 text-accent">{matchText}</span>
      {after}
    </>
  );
};

export const SearchMatchItem = memo(
  ({
    filePath,
    displayPath,
    match,
    index,
    isSelected,
    onSelect,
    onPreview,
    style,
  }: SearchMatchItemProps) => {
    const fileName = filePath.split("/").pop() || "";
    const dirPath = displayPath.substring(0, displayPath.lastIndexOf("/"));

    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-item-index={index}
        onClick={() => onSelect(filePath, match.line_number)}
        onMouseEnter={onPreview ? () => onPreview(filePath) : undefined}
        className={`h-auto w-full justify-start items-start gap-3 px-3 py-1 text-left ${isSelected ? "bg-hover" : ""}`}
        style={style}
      >
        {/* File icon, name and path */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileExplorerIcon
            fileName={fileName}
            isDir={false}
            size={12}
            className="shrink-0 text-text-lighter"
          />
          <span className="ui-text-sm shrink-0 text-text">{fileName}</span>
          {dirPath && (
            <span className="ui-text-sm truncate text-text-lighter opacity-60">{dirPath}</span>
          )}
        </div>

        {/* Line number */}
        <span className="ui-text-sm w-12 shrink-0 text-right text-text-lighter">
          :{match.line_number}
        </span>

        {/* Match content */}
        <div className="ui-text-sm min-w-0 flex-[2] font-mono text-text">
          <div className="truncate">
            {highlightMatch(match.line_content, match.column_start, match.column_end)}
          </div>
        </div>
      </Button>
    );
  },
);
