import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Edit,
  FileText,
  FolderOpen,
  Globe,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "@/utils/cn";
import "./tool-call-display.css";

interface ToolCallDisplayProps {
  toolName: string;
  input?: any;
  output?: any;
  isStreaming?: boolean;
  error?: string;
}

const toolIcons: Record<string, React.ElementType> = {
  // File operations
  Read: FileText,
  Write: Edit,
  Edit: Edit,
  MultiEdit: Edit,

  // Search operations
  Grep: Search,
  Glob: FolderOpen,
  Search: Search,
  Task: Search,

  // System operations
  Bash: Terminal,
  LS: FolderOpen,

  // Web operations
  WebFetch: Globe,
  WebSearch: Globe,

  // Database operations
  NotebookRead: Database,
  NotebookEdit: Database,

  // Default
  default: Wrench,
};

const toolCategories: Record<string, string> = {
  // File operations
  Read: "File Operations",
  Write: "File Operations",
  Edit: "File Operations",
  MultiEdit: "File Operations",

  // Search operations
  Grep: "Search",
  Glob: "Search",
  Search: "Search",
  Task: "Search",

  // System operations
  Bash: "System",
  LS: "System",

  // Web operations
  WebFetch: "Web",
  WebSearch: "Web",

  // Database operations
  NotebookRead: "Notebook",
  NotebookEdit: "Notebook",
};

export default function ToolCallDisplay({
  toolName,
  input,
  output,
  isStreaming,
  error,
}: ToolCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const Icon = toolIcons[toolName] || toolIcons.default;
  const category = toolCategories[toolName] || "Tool";

  // not sure if there are tool calls that can be just empty without any input
  if (!input || (typeof input === "object" && Object.keys(input).length === 0)) {
    return;
  }

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
    <div
      className={cn(
        "tool-call-card rounded-lg border transition-all duration-200",
        isStreaming && "animate-pulse",
        error && "tool-error border-red-500/50",
        !isStreaming && !error && output && "tool-success",
      )}
      style={{
        background: "var(--color-secondary-bg)",
        borderColor: error ? undefined : "var(--color-border)",
      }}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left",
          "transition-colors hover:bg-[var(--color-hover)]",
        )}
      >
        <div className="flex flex-1 items-center gap-2">
          <Icon
            size={14}
            className={cn(error ? "text-red-500" : "", isStreaming && "tool-icon-running")}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{toolName}</span>
              <span className="text-xs opacity-60">({category})</span>
              {isStreaming && (
                <div className="flex items-center gap-1">
                  <Clock size={10} className="animate-spin" />
                  <span className="text-xs">Running...</span>
                </div>
              )}
              {!isStreaming && !error && output && (
                <CheckCircle size={12} className="text-green-500" />
              )}
              {error && <AlertCircle size={12} className="text-red-500" />}
            </div>
            <div className="truncate text-xs opacity-75">{formatInput(input)}</div>
          </div>
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isExpanded && (
        <div className="tool-expand-content space-y-2 px-3 pb-3">
          {/* Input section */}
          <div>
            <div className="mb-1 font-medium text-xs opacity-60">Input:</div>
            <pre
              className="overflow-x-auto rounded p-2 text-xs"
              style={{
                background: "var(--color-primary-bg)",
                border: "1px solid var(--color-border)",
              }}
            >
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>

          {/* Output section */}
          {output && (
            <div>
              <div className="mb-1 font-medium text-xs opacity-60">Output:</div>
              <pre
                className="max-h-48 overflow-x-auto rounded p-2 text-xs"
                style={{
                  background: "var(--color-primary-bg)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {formatOutput(output)}
              </pre>
            </div>
          )}

          {/* Error section */}
          {error && (
            <div>
              <div className="mb-1 font-medium text-red-500 text-xs">Error:</div>
              <div
                className="rounded p-2 text-red-400 text-xs"
                style={{
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                }}
              >
                {error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
