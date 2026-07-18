import { describe, expect, it } from "vite-plus/test";
import { resolveTerminalLaunch, SYSTEM_DEFAULT_PROFILE_ID } from "../utils/terminal-profiles";

describe("resolveTerminalLaunch", () => {
  it("uses the matching WSL shell for WSL workspaces", () => {
    expect(
      resolveTerminalLaunch({
        currentDirectory: "wsl://Ubuntu/home/me/project",
        customProfiles: [],
        settings: {
          terminalDefaultProfileId: SYSTEM_DEFAULT_PROFILE_ID,
          terminalDefaultShellId: "",
        },
        shells: [
          {
            id: "wsl:Ubuntu",
            name: "WSL: Ubuntu",
            kind: "wsl",
            wsl_distribution: "Ubuntu",
          },
        ],
      }),
    ).toMatchObject({
      shell: "wsl:Ubuntu",
      workingDirectory: "wsl://Ubuntu/home/me/project",
    });
  });

  it("uses the WSL startup directory distro over a Windows profile shell", () => {
    expect(
      resolveTerminalLaunch({
        currentDirectory: "/Users/me/project",
        customProfiles: [
          {
            id: "profile-1",
            name: "Project",
            shell: "powershell",
            startupDirectory: "wsl://Debian/home/me/project",
          },
        ],
        explicitProfileId: "profile-1",
        settings: {
          terminalDefaultProfileId: SYSTEM_DEFAULT_PROFILE_ID,
          terminalDefaultShellId: "powershell",
        },
        shells: [
          {
            id: "wsl:Debian",
            name: "WSL: Debian",
            kind: "wsl",
            wsl_distribution: "Debian",
          },
        ],
      }),
    ).toMatchObject({
      shell: "wsl:Debian",
      workingDirectory: "wsl://Debian/home/me/project",
    });
  });
});
