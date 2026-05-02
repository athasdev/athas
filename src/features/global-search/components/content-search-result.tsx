import { File, MagnifyingGlass } from "@phosphor-icons/react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { getRelativePath } from "@/utils/path-helpers";
import type { FileSearchResult, SearchMatch } from "@/features/global-search/lib/rust-api/search";

interface ContentSearchResultProps {
  result: FileSearchResult;
  rootFolderPath: string | null | undefined;
  onFileClick: (filePath: string, lineNumber?: number) => void;
  onFileHover?: (filePath: string | null) => void;
  selectedMatchKey?: string | null;
  getMatchIndex?: (lineNumber: number) => number | undefined;
}

const highlightMatch = (text: string, start: number, end: number) => {
  const before = text.slice(0, start);
  const match = text.slice(start, end);
  const after = text.slice(end);

  return (
    <>
      {before}
      <span className="rounded-sm bg-accent/25 px-0.5 text-accent">{match}</span>
      {after}
    </>
  );
};

const MatchLine = ({
  match,
  onClick,
  onHover,
  isSelected = false,
  itemIndex,
}: {
  match: SearchMatch;
  onClick: () => void;
  onHover?: () => void;
  isSelected?: boolean;
  itemIndex?: number;
}) => {
  return (
    <Button
      onClick={onClick}
      onMouseEnter={onHover}
      variant="ghost"
      size="sm"
      data-item-index={itemIndex}
      className={cn(
        "ui-text-sm editor-font flex h-auto w-full items-start justify-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover/70",
        isSelected && "bg-hover",
      )}
    >
      <span className="w-10 shrink-0 text-right text-text-lighter/80">{match.line_number}</span>
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
  selectedMatchKey,
  getMatchIndex,
}: ContentSearchResultProps) => {
  const displayPath = getRelativePath(result.file_path, rootFolderPath);

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-secondary-bg/35">
      <Button
        onClick={() => onFileClick(result.file_path)}
        onMouseEnter={() => onFileHover?.(result.file_path)}
        variant="ghost"
        size="sm"
        className="flex h-auto w-full items-center justify-start gap-2 rounded-none border-border/70 border-b px-2.5 py-2 hover:bg-hover/70"
      >
        <File className="size-4 shrink-0 text-text-lighter" weight="duotone" />
        <span className="ui-text-sm truncate font-medium text-text">{displayPath}</span>
        <span className="ui-text-xs ml-auto shrink-0 rounded-md border border-border/60 bg-primary-bg/65 px-1.5 py-0.5 text-text-lighter">
          {result.total_matches} {result.total_matches === 1 ? "match" : "matches"}
        </span>
      </Button>

      <div className="space-y-0.5 p-1.5">
        {result.matches.slice(0, 10).map((match, idx) => (
          <MatchLine
            key={`${match.line_number}-${idx}`}
            match={match}
            onClick={() => onFileClick(result.file_path, match.line_number)}
            onHover={onFileHover ? () => onFileHover(result.file_path) : undefined}
            isSelected={selectedMatchKey === `${result.file_path}:${match.line_number}`}
            itemIndex={getMatchIndex?.(match.line_number)}
          />
        ))}
        {result.matches.length > 10 && (
          <div className="ui-text-sm flex items-center gap-2 px-2 py-2 text-text-lighter">
            <MagnifyingGlass className="size-4 shrink-0" weight="duotone" />
            <span>... and {result.matches.length - 10} more matches</span>
          </div>
        )}
      </div>
    </div>
  );
};
