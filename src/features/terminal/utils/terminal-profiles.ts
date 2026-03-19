import type { Settings } from "@/features/settings/store";
import type { Shell, TerminalProfile } from "../types/terminal";

export const SYSTEM_DEFAULT_PROFILE_ID = "system-default";
export const DEFAULT_SHELL_OPTION_VALUE = "system";
export const DEFAULT_PROFILE_LABEL = "Default Terminal";

export interface ResolvedTerminalLaunch {
  shell?: string;
  workingDirectory: string;
  initialCommand?: string;
  name: string;
  profileId?: string;
}

export const getShellProfileId = (shellId: string) => `shell:${shellId}`;

export const getBuiltInTerminalProfiles = (shells: Shell[]): TerminalProfile[] => [
  {
    id: SYSTEM_DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_LABEL,
  },
  ...shells.map((shell) => ({
    id: getShellProfileId(shell.id),
    name: shell.name,
    shell: shell.id,
    icon: "terminal",
  })),
];

export const getAllTerminalProfiles = (
  shells: Shell[],
  customProfiles: TerminalProfile[],
): TerminalProfile[] => [...getBuiltInTerminalProfiles(shells), ...customProfiles];

export const resolveTerminalProfile = (
  profileId: string | undefined,
  shells: Shell[],
  customProfiles: TerminalProfile[],
): TerminalProfile | undefined => {
  if (!profileId) return undefined;
  return getAllTerminalProfiles(shells, customProfiles).find((profile) => profile.id === profileId);
};

export const resolveTerminalLaunch = ({
  currentDirectory,
  customProfiles,
  explicitProfileId,
  settings,
  shells,
}: {
  currentDirectory: string;
  customProfiles: TerminalProfile[];
  explicitProfileId?: string;
  settings: Pick<Settings, "terminalDefaultProfileId" | "terminalDefaultShellId">;
  shells: Shell[];
}): ResolvedTerminalLaunch => {
  const profileId =
    explicitProfileId || settings.terminalDefaultProfileId || SYSTEM_DEFAULT_PROFILE_ID;
  const profile = resolveTerminalProfile(profileId, shells, customProfiles);
  const fallbackShell =
    settings.terminalDefaultShellId &&
    settings.terminalDefaultShellId !== DEFAULT_SHELL_OPTION_VALUE
      ? settings.terminalDefaultShellId
      : undefined;
  const shell = profile?.shell || fallbackShell;
  const initialCommand = profile?.startupCommands?.filter(Boolean).join("\n") || undefined;
  const workingDirectory = profile?.startupDirectory?.trim() || currentDirectory;

  return {
    shell,
    workingDirectory,
    initialCommand,
    name: profile?.name || DEFAULT_PROFILE_LABEL,
    profileId: profile?.id,
  };
};
