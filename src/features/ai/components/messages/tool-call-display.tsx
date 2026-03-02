import { AlertCircle, CheckCircle, ChevronRight, Clock, ExternalLink } from "lucide-react";
import { useState } from "react";
import { cn } from "@/utils/cn";

interface ToolCallDisplayProps {
  toolName: string;
  input?: any;
  output?: any;
  isStreaming?: boolean;
  error?: string;
  onOpenInEditor?: (filePath: string) => void;
}

export default function ToolCallDisplay({
  toolName,
  input,
  output,
  isStreaming,
  error,
  onOpenInEditor,
}: ToolCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasInput =
    Boolean(input) && !(typeof input === "object" && Object.keys(input).length === 0);
  const status = error ? "failed" : isStreaming ? "running" : "completed";
  const statusClass =
    status === "failed"
      ? "text-red-400/70"
      : status === "running"
        ? "text-text-lighter/55"
        : "text-text-lighter/65";

  // Format input parameters for display
  const formatInput = (input: any): string => {
    // Handle null/undefined/empty objects
    if (!input || (typeof input === "object" && Object.keys(input).length === 0)) {
      return "No parameters";
    }

    if (typeof input === "string") return input;

    // Extract filename helper
    const getFilename = (path: string) => path.split("/").pop() || path;

    // Truncate long strings helper
    const truncate = (str: string, maxLength: number = 50) => {
      if (str.length <= maxLength) return str;
      return `${str.substring(0, maxLength)}...`;
    };

    // Special formatting for common tools
    if (toolName === "Read" && input.file_path) {
      return getFilename(input.file_path);
    }

    if (toolName === "Edit" && input.file_path) {
      const filename = getFilename(input.file_path);
      const editType = input.replace_all ? "Replace all" : "Single edit";
      // Show a preview of what's being edited if strings are short
      if (input.old_string && input.old_string.length < 30) {
        return `${filename}: "${truncate(input.old_string, 20)}" → "${truncate(input.new_string || "", 20)}" (${editType})`;
      }
      return `${filename} (${editType})`;
    }

    if (toolName === "Write" && input.file_path) {
      return getFilename(input.file_path);
    }

    if (toolName === "MultiEdit" && input.file_path) {
      const filename = getFilename(input.file_path);
      const editCount = input.edits?.length || 0;
      return `${filename} (${editCount} edit${editCount !== 1 ? "s" : ""})`;
    }

    if ((toolName === "NotebookRead" || toolName === "NotebookEdit") && input.notebook_path) {
      return getFilename(input.notebook_path);
    }

    if (toolName === "Bash" && input.command) {
      return truncate(input.command, 60);
    }

    if (toolName === "Grep" && input.pattern) {
      const pattern = truncate(input.pattern, 30);
      return `Pattern: "${pattern}"${input.path ? ` in ${getFilename(input.path)}` : ""}`;
    }

    if (toolName === "Glob" && input.pattern) {
      return `Pattern: ${input.pattern}${input.path ? ` in ${getFilename(input.path)}` : ""}`;
    }

    if (toolName === "LS" && input.path) {
      return getFilename(input.path);
    }

    if (toolName === "WebSearch" && input.query) {
      return truncate(input.query, 50);
    }

    if (toolName === "WebFetch" && input.url) {
      return truncate(input.url, 50);
    }

    // Default: show meaningful key-value pairs, skip very long values
    const entries = Object.entries(input)
      .filter(([, v]) => v !== null && v !== undefined && (typeof v !== "string" || v.length < 100))
      .slice(0, 3);

    if (entries.length === 0) {
      return "Complex parameters";
    }

    return entries
      .map(([k, v]) => {
        const value = typeof v === "string" ? truncate(v, 30) : JSON.stringify(v);
        return `${k}: ${value}`;
      })
      .join(", ");
  };

  // Format output for display
  const formatOutput = (output: any): string => {
    if (!output) return "No output";

    if (typeof output === "string") {
      // Truncate long outputs
      if (output.length > 100) {
        return `${output.substring(0, 100)}...`;
      }
      return output;
    }

    return JSON.stringify(output, null, 2);
  };

  return (
    <div className="py-0.5 leading-tight">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="group flex min-w-0 flex-1 items-center gap-1 text-left text-xs"
        >
          <span className="font-medium text-text-lighter/80">{toolName}</span>
          <span className="opacity-40">·</span>
          <span className="truncate text-text-lighter/60">{formatInput(input)}</span>
          <ChevronRight
            size={9}
            className={cn(
              "ml-auto opacity-30 transition-transform duration-200 group-hover:opacity-50",
              isExpanded && "rotate-90",
            )}
          />
        </button>
        {toolName === "Read" && hasInput && input?.file_path && !isStreaming && !error && (
          <button
            onClick={() => onOpenInEditor?.(input.file_path)}
            className="rounded-full p-1 text-text-lighter/60 transition-all hover:bg-hover hover:text-text-lighter/90"
            title="Open in editor"
            aria-label="Open file in editor"
          >
            <ExternalLink size={10} />
          </button>
        )}
        {status === "running" ? (
          <Clock size={10} className={cn("shrink-0 animate-spin", statusClass)} />
        ) : null}
        {status === "completed" ? (
          <CheckCircle size={10} className={cn("shrink-0", statusClass)} />
        ) : null}
        {status === "failed" ? (
          <AlertCircle size={10} className={cn("shrink-0", statusClass)} />
        ) : null}
      </div>

      {isExpanded && (
        <div className="mt-1 space-y-1 pl-3 text-[11px] text-text-lighter/60">
          {/* Input section */}
          <div>
            <div className="mb-0.5 font-medium opacity-55">Input</div>
            <pre className="editor-font max-h-48 overflow-x-auto whitespace-pre-wrap text-[11px]">
              {hasInput ? JSON.stringify(input, null, 2) : "No parameters"}
            </pre>
          </div>

          {/* Output section */}
          {output && (
            <div>
              <div className="mb-0.5 font-medium opacity-55">Output</div>
              <pre className="editor-font max-h-48 overflow-x-auto whitespace-pre-wrap text-[11px]">
                {formatOutput(output)}
              </pre>
            </div>
          )}

          {/* Error section */}
          {error && (
            <div>
              <div className="mb-0.5 font-medium text-red-400 opacity-80">Error</div>
              <pre className="editor-font max-h-48 overflow-x-auto whitespace-pre-wrap text-[11px] text-red-400">
                {error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
