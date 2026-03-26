import { File } from "lucide-react";
import { Button } from "@/ui/button";
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
    <Button
      onClick={onClick}
      onMouseEnter={onHover}
      variant="ghost"
      size="sm"
      className="ui-text-sm flex h-auto w-full items-start justify-start gap-2 px-4 py-1 text-left font-mono hover:bg-hover"
    >
      <span className="w-10 shrink-0 text-right text-text-lighter">{match.line_number}</span>
      <span className="flex-1 truncate text-text">
        {highlightMatch(match.line_content, match.column_start, match.column_end)}
      </span>
    </Button>
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
      <Button
        onClick={() => onFileClick(result.file_path)}
        onMouseEnter={() => onFileHover?.(result.file_path)}
        variant="ghost"
        size="sm"
        className="flex h-auto w-full items-center justify-start gap-2 px-2 py-1.5 hover:bg-hover"
      >
        <File className="shrink-0 text-text-lighter" />
        <span className="ui-text-sm truncate font-medium text-text">{displayPath}</span>
        <span className="ui-text-sm ml-auto shrink-0 text-text-lighter">
          {result.total_matches} {result.total_matches === 1 ? "match" : "matches"}
        </span>
      </Button>

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
          <div className="ui-text-sm px-4 py-1 text-text-lighter">
            ... and {result.matches.length - 10} more matches
          </div>
        )}
      </div>
    </div>
  );
};
