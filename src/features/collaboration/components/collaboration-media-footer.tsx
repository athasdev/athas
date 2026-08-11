import { MicrophoneIcon as Mic, MonitorIcon as Monitor } from "@/ui/icons";
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
    <SidebarFooter>
      <div className="flex min-w-0 items-center gap-1 px-1 py-1">
        <Button
          type="button"
          variant={micState === "error" ? "danger" : "ghost"}
          active={micState === "active"}
          tooltip={micState === "active" ? "Stop Mic" : "Start Mic"}
          tooltipSide="top"
          onClick={onToggleMic}
          size="icon-sm"
        >
          <Mic />
        </Button>
        <Button
          type="button"
          variant={screenState === "error" ? "danger" : "ghost"}
          active={screenState === "active"}
          tooltip={screenState === "active" ? "Stop Screen Share" : "Share Screen"}
          tooltipSide="top"
          onClick={onToggleScreenShare}
          size="icon-sm"
        >
          <Monitor />
        </Button>
        <div className="ui-text-sm min-w-0 flex-1 truncate px-1">
          <span className="font-medium text-foreground">{workspaceName}</span>
          <span className="px-1 text-subtle-foreground">·</span>
          <span className="text-subtle-foreground">{onlineCount} online</span>
          <span className="px-1 text-subtle-foreground">·</span>
          <span className="text-subtle-foreground">{streamStatus}</span>
        </div>
        {isFollowing ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={onStopFollowing}
          >
            Stop
          </Button>
        ) : null}
      </div>
    </SidebarFooter>
  );
}
