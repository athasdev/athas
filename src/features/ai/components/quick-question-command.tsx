import { CaretLeft, Copy, Sparkle as Sparkles } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getQuickQuestionCompletionStream } from "@/features/ai/services/ai-chat-service";
import type { ContextInfo } from "@/features/ai/types/ai-context";
import MarkdownRenderer from "@/features/ai/components/messages/markdown-renderer";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useToast } from "@/features/layout/contexts/toast-context";
import type { PaneContent } from "@/features/panes/types/pane-content";
import { useSettingsStore } from "@/features/settings/store";
import { getModelById, getProviderById } from "@/features/ai/types/providers";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandHeader, CommandInput, CommandItem, CommandList } from "@/ui/command";

interface QuickQuestionCommandContentProps {
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
  activeBuffer: PaneContent | null;
  buffers: PaneContent[];
  projectRoot?: string | null;
}

const languageMap: Record<string, string> = {
  js: "JavaScript",
  jsx: "JavaScript (React)",
  ts: "TypeScript",
  tsx: "TypeScript (React)",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  cpp: "C++",
  c: "C",
  css: "CSS",
  html: "HTML",
  json: "JSON",
  md: "Markdown",
  sql: "SQL",
  sh: "Shell Script",
  yml: "YAML",
  yaml: "YAML",
};

function getLanguageForBuffer(buffer: PaneContent | null): string | undefined {
  if (!buffer || buffer.type === "webViewer") return undefined;
  const extension = buffer.path.split(".").pop()?.toLowerCase() || "";
  return languageMap[extension] || "Text";
}

function getReadableError(error: string): string {
  const [summary, details] = error.split("|||");
  if (details) {
    try {
      const parsed = JSON.parse(details);
      return parsed.error?.message || summary;
    } catch {
      return summary;
    }
  }
  return summary;
}

async function copyText(text: string) {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

export function QuickQuestionCommandContent({
  isActive,
  onBack,
  onClose,
  activeBuffer,
  buffers,
  projectRoot,
}: QuickQuestionCommandContentProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const { settings } = useSettingsStore();
  const subscription = useAuthStore((state) => state.subscription);
  const { showToast } = useToast();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const provider = getProviderById(settings.aiProviderId);
  const model = getModelById(settings.aiProviderId, settings.aiModelId);
  const enterprisePolicy = subscription?.enterprise?.policy;
  const isBlockedByPolicy = Boolean(
    enterprisePolicy?.managedMode && !enterprisePolicy.aiChatEnabled,
  );

  const context = useMemo<ContextInfo>(() => {
    const contextualActiveBuffer =
      activeBuffer && activeBuffer.type !== "agent" ? activeBuffer : undefined;
    return {
      activeBuffer: contextualActiveBuffer,
      openBuffers: buffers.filter((buffer) => buffer.type !== "agent"),
      projectRoot: projectRoot || undefined,
      providerId: settings.aiProviderId,
      agentId: "custom",
      language: getLanguageForBuffer(activeBuffer),
    };
  }, [activeBuffer, buffers, projectRoot, settings.aiProviderId]);

  useEffect(() => {
    if (!isActive) {
      requestIdRef.current += 1;
      return;
    }

    setQuestion("");
    setAnswer("");
    setError("");
    setIsLoading(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isActive]);

  const handleSubmit = async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) return;

    if (isBlockedByPolicy) {
      setError("AI chat is disabled by enterprise policy.");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setAnswer("");
    setError("");
    setIsLoading(true);

    await getQuickQuestionCompletionStream(
      settings.aiProviderId,
      settings.aiModelId,
      trimmedQuestion,
      context,
      (chunk) => {
        if (requestIdRef.current !== requestId) return;
        setAnswer((current) => current + chunk);
      },
      () => {
        if (requestIdRef.current !== requestId) return;
        setIsLoading(false);
      },
      (streamError) => {
        if (requestIdRef.current !== requestId) return;
        setError(getReadableError(streamError));
        setIsLoading(false);
      },
    );
  };

  const handleCopy = async () => {
    if (!answer.trim()) return;
    await copyText(answer);
    showToast({ message: "Answer copied.", type: "success" });
  };

  const modelLabel = `${provider?.name || settings.aiProviderId} / ${model?.name || settings.aiModelId}`;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (
          event.target === inputRef.current &&
          event.key === "Enter" &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          void handleSubmit();
        }
      }}
    >
      <CommandHeader onClose={onClose}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded"
          onClick={onBack}
          aria-label="Back to commands"
        >
          <CaretLeft className="text-text-lighter" />
        </Button>
        <Sparkles className="shrink-0 text-text-lighter" size={15} weight="duotone" />
        <CommandInput
          ref={inputRef}
          value={question}
          onChange={setQuestion}
          placeholder="Ask AI a quick question..."
          className="min-w-0"
        />
      </CommandHeader>

      <CommandList>
        {!question.trim() && !answer && !error && !isLoading ? (
          <CommandEmpty>
            <div className="flex items-center justify-center gap-1.5">
              <ProviderIcon providerId={settings.aiProviderId} size={12} />
              <span className="truncate">{modelLabel}</span>
            </div>
          </CommandEmpty>
        ) : error ? (
          <CommandEmpty>
            <span className="text-error">{error}</span>
          </CommandEmpty>
        ) : answer ? (
          <div className="px-3 py-2">
            <div className="ui-text-sm max-h-48 overflow-y-auto text-text">
              <MarkdownRenderer content={answer} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 border-border border-t pt-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-lighter">
                <ProviderIcon providerId={settings.aiProviderId} size={11} />
                <span className="truncate">{modelLabel}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded"
                onClick={() => void handleCopy()}
                tooltip="Copy answer"
              >
                <Copy className="text-text-lighter" size={12} />
              </Button>
            </div>
          </div>
        ) : isLoading ? (
          <CommandEmpty>Thinking...</CommandEmpty>
        ) : (
          <CommandItem
            isSelected
            onClick={() => void handleSubmit()}
            className="px-3 py-2"
            disabled={!question.trim()}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs">Ask quick question</div>
              <div className="truncate text-[11px] text-text-lighter">{modelLabel}</div>
            </div>
          </CommandItem>
        )}
      </CommandList>
    </div>
  );
}
