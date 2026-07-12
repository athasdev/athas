import { openUrl } from "@tauri-apps/plugin-opener";
import { UsersThreeIcon as UsersThree } from "@/ui/icons";
import { useCollaborationRuntimeStore } from "@/features/collaboration/stores/collaboration-runtime.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { getApiBase } from "@/utils/api-base";
import Section, { SettingRow } from "../settings-section";

export const CollaborationSettings = () => {
  const user = useAuthStore((state) => state.user);
  const collaboration = useAuthStore((state) => state.subscription?.collaboration);
  const activeDocumentStream = useCollaborationRuntimeStore((state) => state.activeDocumentStream);
  const presenceTarget = useCollaborationRuntimeStore((state) => state.presenceTarget);
  const collaborationRuntimeActions = useCollaborationRuntimeStore((state) => state.actions);

  const workspace = collaboration?.workspace;
  const members = collaboration?.members ?? [];
  const invitations = collaboration?.invitations ?? [];
  const channels = collaboration?.channels ?? [];
  const activeMembers = members.filter((member) => member.status === "active");
  const selectedChannel = channels.find((channel) => channel.id === presenceTarget.channelId);
  const followedMember = members.find(
    (member) => member.userId && member.userId === presenceTarget.followingUserId,
  );
  const followableMembers = members.filter(
    (member) => member.status === "active" && member.userId && member.userId !== user?.id,
  );
  const invitePolicy = collaboration?.settings?.sharedSettings.invitePolicy ?? "admins_only";
  const seatLimit = String(collaboration?.settings?.sharedSettings.memberSeatLimit ?? "Unlimited");
  const updateLimit = String(
    collaboration?.settings?.sharedSettings.monthlyDocumentUpdateLimit ?? "Unlimited",
  );

  const openDashboardCollaboration = () => {
    void openUrl(new URL("/dashboard/collaboration", getApiBase()).toString());
  };

  return (
    <div className="space-y-4">
      <Section
        title={workspace?.name ?? "Collaboration"}
        description="Teams workspace status. Manage members, channels, invites, and policies in the web dashboard."
      >
        <SettingRow label="Dashboard" description="Open the full collaboration workspace.">
          <Button
            type="button"
            variant="default"
            className="ui-text-base"
            onClick={openDashboardCollaboration}
            size="xs"
          >
            <UsersThree />
            Open
          </Button>
        </SettingRow>

        <SettingRow label="Members" description={`${invitations.length} pending invitations`}>
          <Badge variant="default" size="compact">
            {activeMembers.length}/{members.length} active
          </Badge>
        </SettingRow>

        <SettingRow
          label="Channels"
          description={selectedChannel ? `Joined #${selectedChannel.slug}` : "No channel selected"}
        >
          <Badge variant="default" size="compact">
            {channels.length} channels
          </Badge>
        </SettingRow>

        <SettingRow
          label="Presence"
          description={followedMember ? `Following ${followedMember.name}` : "Not following anyone"}
        >
          <div className="flex items-center gap-2">
            <Badge variant="default" size="compact">
              {collaboration?.presence.length ?? 0} sessions
            </Badge>
            <Button
              type="button"
              variant="default"
              className="ui-text-base"
              disabled={!presenceTarget.channelId && !presenceTarget.followingUserId}
              onClick={() => {
                collaborationRuntimeActions.setPresenceChannel(null);
                collaborationRuntimeActions.setFollowingUser(null);
              }}
            >
              Clear
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Document Stream"
          description={
            activeDocumentStream.path
              ? `${activeDocumentStream.path} · v${activeDocumentStream.lastServerVersion}`
              : "No active document stream"
          }
        >
          <Badge
            variant={activeDocumentStream.status === "error" ? "error" : "default"}
            size="compact"
          >
            {activeDocumentStream.status}
          </Badge>
        </SettingRow>

        <SettingRow label="Workspace Rules" description={`Invites: ${invitePolicy}`}>
          <Badge variant="default" size="compact">
            Seats {seatLimit} · Updates {updateLimit}
          </Badge>
        </SettingRow>
      </Section>

      {channels.length || followableMembers.length ? (
        <Section title="Quick Presence">
          {channels.slice(0, 4).map((channel) => (
            <SettingRow
              key={`channel-${channel.id}`}
              label={`#${channel.slug}`}
              description={`${channel.memberCount} members · ${channel.guestCount} guests`}
            >
              <Button
                type="button"
                variant={presenceTarget.channelId === channel.id ? "accent" : "default"}
                className="ui-text-base"
                disabled={!collaboration?.capabilities.presence}
                onClick={() => collaborationRuntimeActions.setPresenceChannel(channel.id)}
              >
                Join
              </Button>
            </SettingRow>
          ))}

          {followableMembers.slice(0, 4).map((member) => (
            <SettingRow key={`follow-${member.id}`} label={member.name} description={member.email}>
              <Button
                type="button"
                variant={presenceTarget.followingUserId === member.userId ? "accent" : "default"}
                className="ui-text-base"
                disabled={!collaboration?.capabilities.presence}
                onClick={() => collaborationRuntimeActions.setFollowingUser(member.userId)}
              >
                Follow
              </Button>
            </SettingRow>
          ))}
        </Section>
      ) : null}
    </div>
  );
};
