import { File } from "lucide-react";
import type { FileSearchResult, SearchMatch } from "@/features/global-search/lib/rust-api/search";

interface ContentSearchResultProps {
  result: FileSearchResult;
  rootFolderPath: string | null | undefined;
  onFileClick: (filePath: string, lineNumber?: number) => void;
  onFileHover?: (filePath: string | null) => void;
}

const highlightMatch = (text: string, start: number, end: number) => {
  const before = text.slice(0, start);
  const match = text.slice(start, end);
  const after = text.slice(end);

  return (
    <>
      {before}
      <span className="bg-accent/30 text-accent">{match}</span>
      {after}
    </>
  );
};

const MatchLine = ({
  match,
  onClick,
  onHover,
}: {
  match: SearchMatch;
  onClick: () => void;
  onHover?: () => void;
}) => {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      className="flex w-full items-start gap-2 px-4 py-1 text-left font-mono text-[11px] hover:bg-hover"
    >
      <span className="w-10 flex-shrink-0 text-right text-text-lighter">{match.line_number}</span>
      <span className="flex-1 truncate text-text">
        {highlightMatch(match.line_content, match.column_start, match.column_end)}
      </span>
    </button>
  );
};

export const ContentSearchResult = ({
  result,
  rootFolderPath,
  onFileClick,
  onFileHover,
}: ContentSearchResultProps) => {
  const displayPath = rootFolderPath
    ? result.file_path.replace(rootFolderPath, "").replace(/^\//, "")
    : result.file_path;

  return (
    <div className="mb-2">
      {/* File header */}
      <button
        onClick={() => onFileClick(result.file_path)}
        onMouseEnter={() => onFileHover?.(result.file_path)}
        className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-hover"
      >
        <File size={12} className="flex-shrink-0 text-text-lighter" />
        <span className="truncate font-medium text-text text-xs">{displayPath}</span>
        <span className="ml-auto flex-shrink-0 text-[10px] text-text-lighter">
          {result.total_matches} {result.total_matches === 1 ? "match" : "matches"}
        </span>
      </button>

      {/* Matched lines */}
      <div className="ml-2">
        {result.matches.slice(0, 10).map((match, idx) => (
          <MatchLine
            key={`${match.line_number}-${idx}`}
            match={match}
            onClick={() => onFileClick(result.file_path, match.line_number)}
            onHover={onFileHover ? () => onFileHover(result.file_path) : undefined}
          />
        ))}
        {result.matches.length > 10 && (
          <div className="px-4 py-1 text-[10px] text-text-lighter">
            ... and {result.matches.length - 10} more matches
          </div>
        )}
      </div>
    </div>
  );
};
