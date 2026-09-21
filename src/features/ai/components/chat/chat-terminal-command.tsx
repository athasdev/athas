import { useState } from "react";
import { Button } from "@/ui/button";
import { CopyIcon, StopIcon, TerminalIcon } from "@/ui/icons";
import { writeClipboardText } from "@/utils/clipboard";
import { useToast } from "@/features/layout/contexts/toast-context";
import {
  isChatTerminalRunning,
  stopChatTerminalCommand,
} from "../../services/chat-terminal-command";
import type { Message } from "../../types/ai-chat.types";
import { ChatActivityLine } from "./chat-activity-line";

export function ChatTerminalCommand({ message }: { message: Message }) {
  const call = message.toolCalls?.[0];
  const [stopping, setStopping] = useState(false);
  const { showToast } = useToast();
  const running = !call?.isComplete && isChatTerminalRunning(message.id);
  const output = call?.output;
  const text = [output?.stdout, output?.stderr, call?.error].filter(Boolean).join("\n");
  const failed = Boolean(
    call?.error ||
    output?.timedOut ||
    (call?.isComplete && output?.exitCode !== 0 && !output?.cancelled),
  );
  const status = running
    ? stopping
      ? "Stopping…"
      : "Running…"
    : output?.cancelled
      ? "Stopped"
      : output?.timedOut
        ? "Timed out after 60 seconds"
        : !call?.isComplete
          ? "Interrupted"
          : failed
            ? output?.exitCode == null
              ? "Failed"
              : `Exit ${output.exitCode}`
            : "Done";

  const stop = async () => {
    setStopping(true);
    try {
      await stopChatTerminalCommand(message.id);
    } catch (error) {
      setStopping(false);
      showToast({ message: String(error), type: "error" });
    }
  };

  return (
    <div className="min-w-0 px-4 py-1" data-ai-element="terminal-command">
      <ChatActivityLine
        icon={<TerminalIcon />}
        title={message.content}
        detail={status}
        state={running ? "running" : failed ? "error" : output?.exitCode === 0 ? "success" : "info"}
        defaultExpanded
        actions={
          <div className="flex items-center gap-1">
            {running && (
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                disabled={stopping}
                tooltip="Stop command"
                onClick={() => void stop()}
              >
                <StopIcon />
              </Button>
            )}
            {text && (
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                tooltip="Copy command output"
                onClick={() =>
                  void writeClipboardText(text).catch((error) =>
                    showToast({ message: String(error), type: "error" }),
                  )
                }
              >
                <CopyIcon />
              </Button>
            )}
          </div>
        }
      >
        {text ||
          (running
            ? "Waiting for output…"
            : call?.isComplete
              ? "No output"
              : "This command is no longer running. Type it again to rerun.")}
      </ChatActivityLine>
    </div>
  );
}
