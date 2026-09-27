import {
  BookOpenIcon,
  FileCodeIcon,
  GitDiffIcon,
  HistoryIcon,
  SearchIcon,
  SparkleIcon,
  TerminalWindowIcon,
  WarningIcon,
} from "@/ui/icons";
import { useMemo } from "react";
import { buildAgentSuggestions } from "@/features/ai/lib/agent-suggestions";
import { selectAgentSessions } from "@/features/ai/lib/agent-session-list";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import { dispatchAIChatSkillInsert } from "@/features/ai/lib/skill-events";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentSuggestion } from "@/features/ai/types/agent-suggestion.types";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useGitStore } from "@/features/git/stores/git.store";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { getRelativePath } from "@/utils/path-helpers";

const RECENT_CHAT_LIMIT = 3;
const promptIcons = [SparkleIcon, SearchIcon, TerminalWindowIcon, BookOpenIcon];
const promptIconClassNames = ["text-primary", "text-success", "text-warning", "text-destructive"];

function SuggestionIcon({ suggestion, index }: { suggestion: AgentSuggestion; index: number }) {
  if (suggestion.kind === "review") return <GitDiffIcon className="text-primary" />;
  if (suggestion.kind === "problems") return <WarningIcon className="text-warning" />;
  if (suggestion.kind === "file") return <FileCodeIcon className="text-success" />;
  const Icon = promptIcons[index % promptIcons.length];
  return <Icon className={promptIconClassNames[index % promptIconClassNames.length]} />;
}

/** The editor file the user is looking at, even while an agent tab has focus. */
function useFocusedEditorFile() {
  const paneActiveIds = usePaneStore((state) =>
    state.actions
      .getAllPaneGroups()
      .map((pane) => pane.activeBufferId ?? "")
      .join("\n"),
  );
  return useBufferStore((state) => {
    const candidates = [state.activeBufferId, ...paneActiveIds.split("\n")];
    for (const id of candidates) {
      const buffer = id ? state.buffers.find((candidate) => candidate.id === id) : undefined;
      if (buffer?.type === "editor" && !buffer.isVirtual) return buffer.path;
    }
    return null;
  });
}

export function AgentShortcuts({
  className,
  surfaceId,
}: {
  className?: string;
  surfaceId: string;
}) {
  const skills = useSettingsStore((state) => state.settings.aiSkills);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const changedFileCount = useGitStore((state) => state.workspaceGitStatus?.files.length ?? 0);
  const problemCount = useDiagnosticsStore((state) => {
    let count = 0;
    for (const diagnostics of state.diagnosticsByFile.values()) {
      for (const diagnostic of diagnostics) if (diagnostic.severity !== "info") count++;
    }
    return count;
  });
  const activeFilePath = useFocusedEditorFile();
  const chats = useAIChatStore((state) => state.chats);
  const recentChats = useMemo(
    () =>
      selectAgentSessions(chats, { workspacePath: rootFolderPath, includePinned: false }).slice(
        0,
        RECENT_CHAT_LIMIT,
      ),
    [chats, rootFolderPath],
  );

  const suggestions = useMemo(
    () =>
      buildAgentSuggestions({
        changedFileCount,
        problemCount,
        activeFile: activeFilePath
          ? {
              name: activeFilePath.split(/[\\/]/).pop() || activeFilePath,
              relativePath: getRelativePath(activeFilePath, rootFolderPath) || activeFilePath,
            }
          : null,
        skills,
      }),
    [activeFilePath, changedFileCount, problemCount, rootFolderPath, skills],
  );

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <section className="flex flex-col gap-0.5" aria-label="Suggestions">
        {suggestions.map((suggestion, index) => (
          <Button
            key={suggestion.id}
            type="button"
            variant="ghost"
            width="full"
            align="start"
            truncate
            onClick={() =>
              dispatchAIChatSkillInsert(
                {
                  id: suggestion.id,
                  title: suggestion.title,
                  content: suggestion.content,
                  createdAt: "",
                  updatedAt: "",
                },
                surfaceId,
              )
            }
          >
            <SuggestionIcon suggestion={suggestion} index={index} />
            <span className="min-w-0 truncate">{suggestion.title}</span>
          </Button>
        ))}
      </section>
      {recentChats.length > 0 ? (
        <section className="flex flex-col gap-0.5" aria-label="Recent chats">
          <h3 className="px-2 text-subtle-foreground ui-text-sm">Recent</h3>
          {recentChats.map((chat) => (
            <Button
              key={chat.id}
              type="button"
              variant="ghost"
              width="full"
              align="start"
              truncate
              title={chat.title}
              onClick={() => openAgentHistoryChat(chat.id)}
            >
              <HistoryIcon className="text-subtle-foreground" />
              <span className="min-w-0 truncate">{chat.title}</span>
            </Button>
          ))}
        </section>
      ) : null}
    </div>
  );
}
