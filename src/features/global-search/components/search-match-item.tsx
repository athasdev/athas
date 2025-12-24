import FileIcon from "@/features/file-explorer/views/file.icon";
import type { SearchMatch } from "@/features/global-search/lib/rust-api/search";

interface SearchMatchItemProps {
  filePath: string;
  displayPath: string;
  match: SearchMatch;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onHover?: () => void;
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

export const SearchMatchItem = ({
  filePath,
  displayPath,
  match,
  index,
  isSelected,
  onClick,
  onHover,
}: SearchMatchItemProps) => {
  const fileName = filePath.split("/").pop() || "";
  const dirPath = displayPath.substring(0, displayPath.lastIndexOf("/"));

  return (
    <button
      data-item-index={index}
      onClick={onClick}
      onMouseEnter={onHover}
      className={`flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-hover ${isSelected ? "bg-hover" : ""}`}
    >
      {/* File icon, name and path */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <FileIcon
          fileName={fileName}
          isDir={false}
          size={12}
          className="shrink-0 text-text-lighter"
        />
        <span className="shrink-0 text-[11px] text-text">{fileName}</span>
        {dirPath && (
          <span className="truncate text-[11px] text-text-lighter opacity-60">{dirPath}</span>
        )}
      </div>

      {/* Line number */}
      <span className="w-12 shrink-0 text-right text-[11px] text-text-lighter">
        :{match.line_number}
      </span>

      {/* Match content */}
      <div className="min-w-0 flex-[2] font-mono text-[11px] text-text">
        <div className="truncate">
          {highlightMatch(match.line_content, match.column_start, match.column_end)}
        </div>
      </div>
    </button>
  );
};
