import { describe, expect, it } from "vitest";
import type { RemoteConnection } from "@/features/remote/types/remote.types";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import {
  getClosedRemoteConnections,
  getProjectRemoteConnectionId,
} from "../components/sidebar/project-switcher-items";

const remoteConnection = (id: string): RemoteConnection => ({
  id,
  name: id,
  host: `${id}.example.com`,
  port: 22,
  username: "developer",
  type: "ssh",
  isConnected: false,
});

const project = (id: string, path: string): ProjectTab => ({
  id,
  name: id,
  path,
  isActive: false,
  lastOpened: 0,
});

describe("project switcher items", () => {
  it("recognizes the saved connection represented by an open remote project", () => {
    expect(getProjectRemoteConnectionId("remote://production/home/developer/app")).toBe(
      "production",
    );
    expect(getProjectRemoteConnectionId("/Users/developer/app")).toBeUndefined();
  });

  it("shows saved remote connections that are not already represented by projects", () => {
    const connections = [remoteConnection("production"), remoteConnection("staging")];
    const projects = [
      project("local-project", "/Users/developer/app"),
      project("remote-project", "remote://production/home/developer/app"),
    ];

    expect(getClosedRemoteConnections(projects, connections)).toEqual([connections[1]]);
  });
});
