import { useMemo, useState } from "react";
import type {
  ExtensionViewDiffLineType,
  ExtensionViewNode,
} from "@/extensions/ui/types/extension-view";
import {
  HighlightedCode,
  useCodeHighlightSegments,
} from "@/features/editor/markdown/highlighted-code";
import { Button } from "@/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import { ChevronRightIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";

/** Rows shown before the rest of a long diff waits behind "Show more". */
const COLLAPSED_ROW_LIMIT = 40;

type ExtensionDiffNode = Extract<ExtensionViewNode, { type: "diff" }>;
type ExtensionDiffPreviewProps = Omit<ExtensionDiffNode, "type">;

const lineClassNames: Record<ExtensionViewDiffLineType, string> = {
  added: "bg-git-added-soft shadow-[inset_2px_0_0_var(--git-added)]",
  removed: "bg-git-deleted-soft shadow-[inset_2px_0_0_var(--git-deleted)]",
  context: "bg-background",
  header: "bg-surface text-subtle-foreground",
};

function languageFromPath(filePath: string): string | undefined {
  const fileName = filePath.replace(/:\d+$/, "").split(/[\\/]/).pop() ?? "";
  const separator = fileName.lastIndexOf(".");
  return separator > 0 ? fileName.slice(separator + 1) : undefined;
}

function lineMarker(type: ExtensionViewDiffLineType): string {
  if (type === "added") return "+";
  if (type === "removed") return "-";
  return " ";
}

export function ExtensionDiffPreview({
  filePath,
  oldPath,
  language,
  lines,
  truncated,
}: ExtensionDiffPreviewProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [showAllRows, setShowAllRows] = useState(false);
  const additions = lines.filter((line) => line.type === "added").length;
  const deletions = lines.filter((line) => line.type === "removed").length;

  // Highlight the diff as one text so tokens that depend on earlier lines stay right, then give
  // each line its slice of the segments.
  const { code, lineOffsets } = useMemo(() => {
    const offsets: number[] = [];
    let length = 0;
    for (const line of lines) {
      offsets.push(length);
      length += (line.type === "header" ? 0 : line.content.length) + 1;
    }
    const text = lines.map((line) => (line.type === "header" ? "" : line.content)).join("\n");
    return { code: text, lineOffsets: offsets };
  }, [lines]);
  const segments = useCodeHighlightSegments(code, language ?? languageFromPath(filePath));

  const hiddenRowCount = showAllRows ? 0 : Math.max(0, lines.length - COLLAPSED_ROW_LIMIT);
  const visibleLines = hiddenRowCount > 0 ? lines.slice(0, COLLAPSED_ROW_LIMIT) : lines;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      render={<figure />}
      data-slot="diff-preview"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-background"
      aria-label={`Diff for ${filePath}, ${additions} additions and ${deletions} deletions`}
    >
      <figcaption className="min-w-0">
        <CollapsibleTrigger
          className={cn(
            "flex min-h-8 w-full min-w-0 items-center gap-2 bg-surface px-2.5 py-1.5 text-left ui-text-sm outline-none transition-colors duration-fast ease-smooth hover:bg-accent focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset",
            isOpen && "border-border border-b",
          )}
        >
          <ChevronRightIcon
            className={cn(
              "shrink-0 text-subtle-foreground transition-transform duration-fast ease-smooth",
              isOpen && "rotate-90",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-foreground" title={filePath}>
              {filePath}
            </span>
            {oldPath && oldPath !== filePath ? (
              <span className="block truncate text-subtle-foreground" title={oldPath}>
                from {oldPath}
              </span>
            ) : null}
          </span>
          {additions > 0 ? (
            <span className="shrink-0 text-git-added tabular-nums">+{additions}</span>
          ) : null}
          {deletions > 0 ? (
            <span className="shrink-0 text-git-deleted tabular-nums">-{deletions}</span>
          ) : null}
        </CollapsibleTrigger>
      </figcaption>
      <CollapsibleContent>
        <div
          role="table"
          aria-label={`Changed lines in ${filePath}`}
          className="max-w-full select-text overflow-x-auto overflow-y-hidden font-mono ui-text-sm"
          data-language={language}
        >
          {visibleLines.map((line, index) => (
            <div
              key={`${line.type}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${index}`}
              role="row"
              className={cn(
                "grid min-w-max grid-cols-[2.5rem_2.5rem_1.25rem_minmax(max-content,1fr)]",
                lineClassNames[line.type],
              )}
            >
              {line.type === "header" ? (
                <>
                  <span
                    role="cell"
                    aria-hidden="true"
                    className="col-span-3 border-border border-r px-2 py-0.5 text-right text-subtle-foreground"
                  >
                    @@
                  </span>
                  <code role="cell" className="px-2.5 py-0.5 text-subtle-foreground">
                    {line.content}
                  </code>
                </>
              ) : (
                <>
                  <span
                    role="cell"
                    aria-hidden="true"
                    className="select-none border-border border-r px-2 py-0.5 text-right text-subtle-foreground tabular-nums"
                  >
                    {line.oldLine ?? ""}
                  </span>
                  <span
                    role="cell"
                    aria-hidden="true"
                    className="select-none border-border border-r px-2 py-0.5 text-right text-subtle-foreground tabular-nums"
                  >
                    {line.newLine ?? ""}
                  </span>
                  <span
                    role="cell"
                    aria-hidden="true"
                    className={cn(
                      "select-none px-1 py-0.5 text-center",
                      line.type === "added" && "text-git-added",
                      line.type === "removed" && "text-git-deleted",
                      line.type === "context" && "text-subtle-foreground",
                    )}
                  >
                    {lineMarker(line.type)}
                  </span>
                  <code role="cell" className="whitespace-pre px-1.5 py-0.5 text-foreground">
                    {line.content ? (
                      <HighlightedCode
                        code={line.content}
                        segments={segments}
                        offset={lineOffsets[index]}
                      />
                    ) : (
                      " "
                    )}
                  </code>
                </>
              )}
            </div>
          ))}
        </div>
        {hiddenRowCount > 0 ? (
          <div className="border-border border-t bg-surface px-1 py-0.5">
            <Button variant="ghost" size="sm" width="full" onClick={() => setShowAllRows(true)}>
              Show {hiddenRowCount} more {hiddenRowCount === 1 ? "line" : "lines"}
            </Button>
          </div>
        ) : null}
        {truncated ? (
          <div className="border-border border-t bg-surface px-2.5 py-1.5 text-subtle-foreground ui-text-sm">
            Diff preview truncated
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
