import {
  CaretLeftIcon as CaretLeft,
  CopyIcon as Copy,
  SparkleIcon as Sparkles,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getQuickQuestionCompletionStream } from "@/features/ai/services/ai-chat-service";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import MarkdownRenderer from "@/features/ai/components/messages/markdown-renderer";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useToast } from "@/features/layout/contexts/toast-context";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { getModelById, getProviderById } from "@/features/ai/types/providers.types";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Button } from "@/ui/button";
import {
  CommandEmpty,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { writeClipboardText } from "@/utils/clipboard";

interface QuickQuestionCommandContentProps {
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
  await writeClipboardText(text);
}

export function QuickQuestionCommandContent({
  onBack,
  onClose,
  activeBuffer,
  buffers,
  projectRoot,
}: QuickQuestionCommandContentProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const aiModelId = useSettingsStore((state) => state.settings.aiModelId);
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const subscription = useAuthStore((state) => state.subscription);
  const { showToast } = useToast();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const provider = getProviderById(aiProviderId);
  const model = getModelById(aiProviderId, aiModelId);
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
      providerId: aiProviderId,
      agentId: "custom",
      language: getLanguageForBuffer(activeBuffer),
    };
  }, [activeBuffer, aiProviderId, buffers, projectRoot]);

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      requestIdRef.current += 1;
      cancelAnimationFrame(focusFrame);
    };
  }, []);

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
      aiProviderId,
      aiModelId,
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

  const modelLabel = `${provider?.name || aiProviderId} / ${model?.name || aiModelId}`;

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
        <CommandHeaderAction type="button" onClick={onBack} aria-label="Back to commands">
          <CaretLeft />
        </CommandHeaderAction>
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
              <ProviderIcon providerId={aiProviderId} size={12} />
              <span className="truncate">{modelLabel}</span>
            </div>
          </CommandEmpty>
        ) : error ? (
          <CommandEmpty>
            <span className="text-error">{error}</span>
          </CommandEmpty>
        ) : answer ? (
          <div className="px-3 py-2">
            <div className="ui-text-base max-h-48 overflow-y-auto text-text">
              <MarkdownRenderer content={answer} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 border-border border-t pt-2">
              <div className="flex min-w-0 items-center gap-1.5 ui-text-base text-text-lighter">
                <ProviderIcon providerId={aiProviderId} size={11} />
                <span className="truncate">{modelLabel}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
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
            className="h-8 px-3 py-0"
            disabled={!question.trim()}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="shrink-0 truncate ui-text-base leading-none">Ask quick question</div>
              <div className="min-w-0 truncate ui-text-base leading-none text-text-lighter">
                {modelLabel}
              </div>
            </div>
          </CommandItem>
        )}
      </CommandList>
    </div>
  );
}
