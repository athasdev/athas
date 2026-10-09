import { MicrophoneIcon, MonitorIcon } from "@/ui/icons";
import { Button } from "@/ui/button";
import { SidebarFooter } from "@/ui/sidebar";
import { getCollaborationStreamLabel } from "@/features/collaboration/lib/collaboration-footer-status";

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
  streamStatus: Parameters<typeof getCollaborationStreamLabel>[0];
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
          variant="ghost"
          tone={micState === "error" ? "danger" : "default"}
          active={micState === "active"}
          tooltip={micState === "active" ? "Stop Mic" : "Start Mic"}
          onClick={onToggleMic}
          iconOnly
        >
          <MicrophoneIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          tone={screenState === "error" ? "danger" : "default"}
          active={screenState === "active"}
          tooltip={screenState === "active" ? "Stop Screen Share" : "Share Screen"}
          onClick={onToggleScreenShare}
          iconOnly
        >
          <MonitorIcon />
        </Button>
        <div className="ui-text-sm min-w-0 flex-1 px-1">
          <div className="truncate font-medium text-foreground">{workspaceName}</div>
          <div className="truncate text-subtle-foreground">
            {onlineCount} online · {getCollaborationStreamLabel(streamStatus)}
          </div>
        </div>
        {isFollowing ? (
          <Button type="button" variant="ghost" tooltip="Stop following" onClick={onStopFollowing}>
            Stop
          </Button>
        ) : null}
      </div>
    </SidebarFooter>
  );
}
