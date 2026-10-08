import { useState } from "react";
import { toast } from "sonner";
import { AcpAuthChoice } from "./acp-auth-choice";
import { ApiErrorActions } from "./api-error-actions";
import { getAcpAuthenticationCommand } from "@/features/ai/lib/acp-authentication";
import {
  getChatErrorActions,
  getChatErrorCode,
  isAgentSetupError,
} from "@/features/ai/lib/chat-error";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { selectAgentAuthRequest, useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatMessageError } from "@/features/ai/types/chat-error.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import { CodeOutput } from "@/ui/code-output";
import { ArrowClockwiseIcon, ChevronRightIcon, TerminalWindowIcon } from "@/ui/icons";
import { ICON_CONCEPTS } from "@/ui/icon-concepts";
import { cn } from "@/utils/cn";

const ErrorIcon = ICON_CONCEPTS["status.error"];

function formatDetails(details: string): string {
  try {
    return JSON.stringify(JSON.parse(details), null, 2);
  } catch {
    return details;
  }
}

/** A failed turn with what the user can do about it. */
export function ChatErrorBlock({
  error,
  chatId,
  onRetry,
}: {
  error: ChatMessageError;
  chatId?: string | null;
  onRetry?: () => void | Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRestartingSession, setIsRestartingSession] = useState(false);
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);
  const openTerminalBuffer = useBufferStore((state) => state.actions.openTerminalBuffer);
  const setActiveBuffer = useBufferStore((state) => state.actions.setActiveBuffer);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const agentId = useAIChatStore((state) => {
    const chatAgentId = chatId
      ? state.chats.find((chat) => chat.id === chatId)?.agentId
      : undefined;
    return chatAgentId ?? state.selectedAgentId;
  });
  const chatProviderId = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === chatId)?.providerId,
  );
  const authRequest = selectAgentAuthRequest(useAcpAuthStore.use.request(), agentId);

  const providerId = error.providerId || chatProviderId || agentId;
  const summary = error.title || error.message || "Error";
  const details = error.details && error.details !== error.message ? error.details : "";
  const code = getChatErrorCode(error);
  const actions = getChatErrorActions(error);
  const canRestartAgent = actions.includes("restart_agent");
  const canOpenAgentTerminal = actions.includes("open_agent_terminal");
  const canRetry = actions.includes("retry") ? onRetry : undefined;
  // Only the latest error offers sign-in, since signing in retries its prompt.
  const showAuthChoice =
    isAgentSetupError(error, "auth") && authRequest !== null && onRetry !== undefined;
  const shownCode = error.status ? String(error.status) : error.code;

  const handleRestartAgentSession = async () => {
    setIsRestartingSession(true);
    try {
      await AcpStreamHandler.restartAgent(agentId, chatId);
      toast.success("Agent session restarted");
    } catch (restartError) {
      console.error("Failed to restart ACP agent session:", restartError);
      toast.error("Couldn't restart the agent session", {
        description: restartError instanceof Error ? restartError.message : String(restartError),
      });
    } finally {
      setIsRestartingSession(false);
    }
  };

  const handleOpenAuthenticationTerminal = async () => {
    setIsOpeningTerminal(true);
    try {
      const agents = await AcpStreamHandler.getAvailableAgents().catch(() => []);
      const command = getAcpAuthenticationCommand(agentId, agents);
      const bufferId = openTerminalBuffer({
        command: command ?? undefined,
        name: command ?? "Agent setup",
        workingDirectory: rootFolderPath ?? undefined,
      });
      setActiveBuffer(bufferId);
    } catch (terminalError) {
      toast.error("Couldn't open the agent terminal", {
        description: terminalError instanceof Error ? terminalError.message : String(terminalError),
      });
    } finally {
      setIsOpeningTerminal(false);
    }
  };

  const hasAgentSetupActions = (canRestartAgent || canOpenAgentTerminal) && !showAuthChoice;

  return (
    <Alert tone="error" data-ai-element="chat-error" className="not-typeset">
      <ErrorIcon />
      <AlertTitle>
        {summary}
        {shownCode ? (
          <span className="ml-1.5 font-normal text-subtle-foreground tabular-nums">
            {shownCode}
          </span>
        ) : null}
      </AlertTitle>
      {error.message && error.message !== summary ? (
        <AlertDescription>{error.message}</AlertDescription>
      ) : null}
      <div className="col-start-2 mt-1.5 flex min-w-0 flex-col gap-2 empty:hidden">
        {actions.includes("provider_settings") || canRetry || hasAgentSetupActions || details ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {actions.includes("provider_settings") ? (
              <ApiErrorActions
                code={code}
                serverCode={error.code}
                billingUrl={error.billingUrl}
                providerId={providerId}
                onRetry={canRetry}
              />
            ) : canRetry ? (
              <Button type="button" variant="default" onClick={() => void canRetry()}>
                <ArrowClockwiseIcon />
                Try again
              </Button>
            ) : null}
            {canRestartAgent && hasAgentSetupActions ? (
              <Button
                type="button"
                variant="default"
                onClick={() => void handleRestartAgentSession()}
                disabled={isRestartingSession}
              >
                <TerminalWindowIcon />
                {isRestartingSession ? "Restarting…" : "Restart agent session"}
              </Button>
            ) : null}
            {canOpenAgentTerminal && hasAgentSetupActions ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleOpenAuthenticationTerminal()}
                disabled={isOpeningTerminal}
              >
                <TerminalWindowIcon />
                {isOpeningTerminal ? "Opening…" : "Open agent terminal"}
              </Button>
            ) : null}
            {details ? (
              <Button
                type="button"
                variant="ghost"
                aria-expanded={isExpanded}
                onClick={() => setIsExpanded(!isExpanded)}
              >
                <ChevronRightIcon
                  className={cn(
                    "transition-transform duration-fast motion-reduce:transition-none",
                    isExpanded && "rotate-90",
                  )}
                />
                {isExpanded ? "Hide details" : "Details"}
              </Button>
            ) : null}
          </div>
        ) : null}
        {hasAgentSetupActions ? (
          <span className="text-muted-foreground">
            {isAgentSetupError(error, "config")
              ? "Finish the agent setup, then restart the session."
              : "Complete login in the agent CLI, then restart the session."}
          </span>
        ) : null}
        {showAuthChoice && authRequest ? (
          <AcpAuthChoice request={authRequest} chatId={chatId} onSignedIn={onRetry} />
        ) : null}
        {details && isExpanded ? (
          <CodeOutput tone="muted" height="default">
            {formatDetails(details)}
          </CodeOutput>
        ) : null}
      </div>
    </Alert>
  );
}
