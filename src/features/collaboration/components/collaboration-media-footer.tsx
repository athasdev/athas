import { MicrophoneIcon as Mic, MonitorIcon as Monitor } from "@/ui/icons";
import { chatComposerIconButtonClassName } from "@/features/ai/components/input/chat-composer-control-styles";
import { Button } from "@/ui/button";
import { SidebarFooter } from "@/ui/sidebar";

type ShareState = "idle" | "active" | "error";

export function CollaborationMediaFooter({
  workspaceName,
  micState,
  screenState,
  onlineCount,
  streamStatus,
  isFollowing,
  onToggleMic,
  onToggleScreenShare,
  onStopFollowing,
}: {
  workspaceName: string;
  micState: ShareState;
  screenState: ShareState;
  onlineCount: number;
  streamStatus: string;
  isFollowing: boolean;
  onToggleMic: () => void;
  onToggleScreenShare: () => void;
  onStopFollowing: () => void;
}) {
  return (
    <SidebarFooter surface className="mx-0 mb-0 pb-0">
      <div className="flex min-w-0 items-center gap-1 px-1 py-1">
        <Button
          type="button"
          variant="ghost"
          active={micState === "active"}
          className={chatComposerIconButtonClassName(
            micState === "error" ? "text-error hover:text-error" : undefined,
          )}
          tooltip={micState === "active" ? "Stop Mic" : "Start Mic"}
          tooltipSide="top"
          onClick={onToggleMic}
        >
          <Mic />
        </Button>
        <Button
          type="button"
          variant="ghost"
          active={screenState === "active"}
          className={chatComposerIconButtonClassName(
            screenState === "error" ? "text-error hover:text-error" : undefined,
          )}
          tooltip={screenState === "active" ? "Stop Screen Share" : "Share Screen"}
          tooltipSide="top"
          onClick={onToggleScreenShare}
        >
          <Monitor />
        </Button>
        <div className="ui-text-sm min-w-0 flex-1 truncate px-1">
          <span className="font-medium text-text">{workspaceName}</span>
          <span className="px-1 text-text-lighter">·</span>
          <span className="text-text-lighter">{onlineCount} online</span>
          <span className="px-1 text-text-lighter">·</span>
          <span className="text-text-lighter">{streamStatus}</span>
        </div>
        {isFollowing ? (
          <Button
            type="button"
            variant="ghost"
            className="ui-text-sm ml-auto h-6 px-2"
            onClick={onStopFollowing}
          >
            Stop
          </Button>
        ) : null}
      </div>
    </SidebarFooter>
  );
}
