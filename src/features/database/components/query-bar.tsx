import { MagnifyingGlassIcon as Search, XIcon as X } from "@/ui/icons";
import { type KeyboardEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useTokenizer } from "@/features/editor/hooks/use-tokenizer";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";
import { cn } from "@/utils/cn";
import { databaseCardClassName } from "./database-surface";
import type { ColumnInfo, TableInfo } from "../types/common.types";
import {
  applySqlCompletion,
  getSqlCompletions,
  type SqlCompletionState,
} from "../lib/sql-completions";
import { buildSqlHighlightSegments } from "../lib/sql-highlight";
import { getSelectedSqlText } from "../lib/sql-selection";

interface QueryBarProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  customQuery: string;
  setCustomQuery: (query: string) => void;
  isCustomQuery: boolean;
  setIsCustomQuery: (is: boolean) => void;
  cancelCustomQuery: () => void;
  executeCustomQuery: (queryOverride?: string) => void;
  lastQueryExecutionMs?: number | null;
  isLoading: boolean;
  isCustomQueryLoading?: boolean;
  tables: TableInfo[];
  tableMeta: ColumnInfo[];
}

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  tables: TableInfo[];
  tableMeta: ColumnInfo[];
}

function SqlEditor({
  value,
  onChange,
  onSelect,
  onKeyDown,
  disabled,
  textareaRef,
  tables,
  tableMeta,
}: SqlEditorProps) {
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const [completionState, setCompletionState] = useState<SqlCompletionState | null>(null);
  const { tokens, tokenize, resetForBufferSwitch } = useTokenizer({
    filePath: "query.sql",
    bufferId: "database-query-editor",
    languageIdOverride: "sql",
    incremental: false,
  });

  useEffect(() => {
    void tokenize(value);
  }, [tokenize, value]);

  useEffect(() => resetForBufferSwitch, [resetForBufferSwitch]);

  const highlightedSql = useMemo(() => buildSqlHighlightSegments(value, tokens), [tokens, value]);
  const updateCompletions = (cursor: number, nextValue = value) => {
    const nextState = getSqlCompletions(nextValue, cursor, { tables, columns: tableMeta });
    setCompletionState(nextState.items.length > 0 ? nextState : null);
  };
  const applyCompletion = (completionIndex: number) => {
    if (!completionState) return;
    const completion = completionState.items[completionIndex];
    if (!completion) return;
    const next = applySqlCompletion(value, completion, completionState);
    onChange(next.value);
    setCompletionState(null);
    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.selectionStart = next.cursor;
      textareaRef.current.selectionEnd = next.cursor;
    });
  };

  return (
    <div className="mb-1">
      <div className={databaseCardClassName("relative h-20 overflow-hidden bg-secondary-bg/60")}>
        <pre
          ref={highlightRef}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mono ui-text-sm leading-5",
            disabled && "opacity-60",
          )}
        >
          {value ? (
            highlightedSql.map((segment, index) =>
              segment.className ? (
                <span key={`${segment.className}-${index}`} className={segment.className}>
                  {segment.text}
                </span>
              ) : (
                segment.text
              ),
            )
          ) : (
            <span className="text-text-lighter">SELECT * FROM table_name</span>
          )}
        </pre>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange(nextValue);
            updateCompletions(event.target.selectionStart, nextValue);
          }}
          onSelect={() => {
            onSelect();
            if (textareaRef.current) updateCompletions(textareaRef.current.selectionStart);
          }}
          onKeyUp={() => {
            onSelect();
            if (textareaRef.current) updateCompletions(textareaRef.current.selectionStart);
          }}
          onMouseUp={() => {
            onSelect();
            if (textareaRef.current) updateCompletions(textareaRef.current.selectionStart);
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab" && completionState?.items.length) {
              event.preventDefault();
              applyCompletion(0);
              return;
            }
            onKeyDown(event);
          }}
          onBlur={() => window.setTimeout(() => setCompletionState(null), 100)}
          onScroll={(event) => {
            if (!highlightRef.current) return;
            highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
          className="relative h-full resize-none border-0 bg-transparent font-mono ui-text-sm leading-5 text-transparent caret-text placeholder:text-transparent selection:bg-accent/30 focus:ring-0"
          placeholder="SELECT * FROM table_name"
          spellCheck={false}
          disabled={disabled}
        />
      </div>
      {completionState && (
        <div className="mt-1 flex flex-wrap gap-1">
          {completionState.items.map((item, index) => (
            <Button
              key={`${item.detail}-${item.value}`}
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 border border-border/60 px-2 text-text-lighter"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyCompletion(index)}
              aria-label={`Insert SQL ${item.detail} ${item.label}`}
              tooltip={item.detail}
            >
              <span className="font-sans ui-text-sm">{item.label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function QueryBar({
  searchTerm,
  setSearchTerm,
  customQuery,
  setCustomQuery,
  isCustomQuery,
  setIsCustomQuery,
  cancelCustomQuery,
  executeCustomQuery,
  lastQueryExecutionMs,
  isLoading,
  isCustomQueryLoading = false,
  tables,
  tableMeta,
}: QueryBarProps) {
  const [draftSearchTerm, setDraftSearchTerm] = useState(searchTerm);
  const [selectedQuery, setSelectedQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousCustomQueryRef = useRef(customQuery);

  useEffect(() => {
    setDraftSearchTerm(searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    if (isCustomQuery || draftSearchTerm === searchTerm) return;
    const timeout = window.setTimeout(() => {
      setSearchTerm(draftSearchTerm);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draftSearchTerm, isCustomQuery, searchTerm, setSearchTerm]);

  useEffect(() => {
    setSelectedQuery("");
  }, [customQuery]);

  useEffect(() => {
    if (!isCustomQuery) {
      previousCustomQueryRef.current = customQuery;
      return;
    }

    const previousCustomQuery = previousCustomQueryRef.current;
    previousCustomQueryRef.current = customQuery;
    const shouldFocus =
      document.activeElement !== textareaRef.current ||
      (previousCustomQuery !== customQuery && selectedQuery.length === 0);

    if (!shouldFocus) return;

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea || document.activeElement === textarea) return;
      textarea.focus();
      const cursor = textarea.value.length;
      textarea.selectionStart = cursor;
      textarea.selectionEnd = cursor;
    });
  }, [customQuery, isCustomQuery, selectedQuery.length]);

  const syncSelectedQuery = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setSelectedQuery(
      getSelectedSqlText(textarea.value, textarea.selectionStart, textarea.selectionEnd),
    );
  };

  const runQuery = () => {
    const textarea = textareaRef.current;
    const latestSelection = textarea
      ? getSelectedSqlText(textarea.value, textarea.selectionStart, textarea.selectionEnd)
      : "";
    const query = latestSelection || selectedQuery || customQuery;
    if (!query.trim()) return;
    executeCustomQuery(latestSelection || selectedQuery || undefined);
  };

  if (isCustomQuery) {
    return (
      <div className="px-3 py-2">
        <SqlEditor
          value={customQuery}
          onChange={setCustomQuery}
          onSelect={syncSelectedQuery}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              runQuery();
            }
          }}
          textareaRef={textareaRef}
          disabled={isLoading}
          tables={tables}
          tableMeta={tableMeta}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="font-sans ui-text-sm text-text-lighter">
            {selectedQuery
              ? "Selection will run"
              : lastQueryExecutionMs !== null && lastQueryExecutionMs !== undefined
                ? `Last run ${lastQueryExecutionMs}ms`
                : "Cmd/Ctrl+Enter to run"}
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setIsCustomQuery(false)} variant="ghost" size="xs">
              Cancel
            </Button>
            {isCustomQueryLoading && (
              <Button onClick={cancelCustomQuery} variant="ghost" size="xs">
                Stop
              </Button>
            )}
            <Button
              onClick={runQuery}
              variant="default"
              disabled={isLoading || !(selectedQuery || customQuery).trim()}
              size="xs"
            >
              {selectedQuery ? "Run Selection" : "Execute"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            value={draftSearchTerm}
            onChange={(e) => setDraftSearchTerm(e.target.value)}
            placeholder="Search..."
            leftIcon={Search}
          />
          {draftSearchTerm && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraftSearchTerm("");
                setSearchTerm("");
              }}
              className="-translate-y-1/2 absolute top-1/2 right-1.5 text-text-lighter hover:text-text"
              aria-label="Clear search"
              tooltip="Clear search"
              size="icon"
            >
              <X />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
