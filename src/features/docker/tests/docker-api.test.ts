import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import {
  buildDockerImage,
  copyFromDockerContainer,
  copyToDockerContainer,
  deleteDockerEnvFile,
  getDockerComposeProject,
  getDockerInventory,
  getDockerProjectConfig,
  listDockerContainerFiles,
  loginDockerRegistry,
  openDockerDevContainer,
  openDockerEnvFile,
  pruneDockerResources,
  runDockerComposeAction,
  runDockerContainerAction,
  runDockerImage,
  runDockerImageAction,
  saveDockerProjectConfig,
  stopDockerContainerLogStream,
} from "../services/docker-api";
import type { DockerProjectConfig } from "../types/docker.types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("docker api", () => {
  it("sends explicit nulls for omitted optional arguments", async () => {
    const compose = vi.spyOn(commands, "dockerComposeAction").mockResolvedValue("up");
    const build = vi.spyOn(commands, "dockerBuildImage").mockResolvedValue("built");
    const run = vi.spyOn(commands, "dockerRunImage").mockResolvedValue("started");
    const project = vi
      .spyOn(commands, "dockerGetComposeProject")
      .mockResolvedValue({ files: [] } as never);
    const config = vi.spyOn(commands, "dockerGetProjectConfig").mockResolvedValue({} as never);
    const login = vi.spyOn(commands, "dockerRegistryLogin").mockResolvedValue("ok");

    await expect(
      runDockerComposeAction({ workspacePath: "/ws", files: ["compose.yaml"], action: "up" }),
    ).resolves.toBe("up");
    await expect(buildDockerImage({ contextPath: "/ws" })).resolves.toBe("built");
    await expect(runDockerImage({ image: "nginx" })).resolves.toBe("started");
    await getDockerComposeProject(undefined);
    await getDockerProjectConfig(undefined);
    await loginDockerRegistry({ username: "dev", password: "pw" });

    expect(compose).toHaveBeenCalledWith("/ws", ["compose.yaml"], null, "up", null);
    expect(build).toHaveBeenCalledWith({
      contextPath: "/ws",
      dockerfilePath: null,
      tag: null,
      buildArgs: null,
    });
    expect(run).toHaveBeenCalledWith({
      image: "nginx",
      name: null,
      ports: null,
      volumes: null,
      env: null,
      envFiles: null,
      command: null,
      detach: null,
    });
    expect(project).toHaveBeenCalledWith(null);
    expect(config).toHaveBeenCalledWith(null);
    expect(login).toHaveBeenCalledWith({ username: "dev", password: "pw", registry: null });
  });

  it("passes provided optional arguments through", async () => {
    const compose = vi.spyOn(commands, "dockerComposeAction").mockResolvedValue("");
    const run = vi.spyOn(commands, "dockerRunImage").mockResolvedValue("");
    const build = vi.spyOn(commands, "dockerBuildImage").mockResolvedValue("");

    await runDockerComposeAction({
      workspacePath: "/ws",
      files: ["a.yaml"],
      service: "web",
      action: "restart",
      envFiles: [".env"],
    });
    await runDockerImage({
      image: "nginx",
      name: "web",
      ports: ["8080:80"],
      volumes: ["/data:/data"],
      env: ["A=1"],
      envFiles: [".env"],
      command: "nginx -g 'daemon off;'",
      detach: true,
    });
    await buildDockerImage({
      contextPath: "/ws",
      dockerfilePath: "Dockerfile.dev",
      tag: "app:dev",
      buildArgs: ["A=1"],
    });

    expect(compose).toHaveBeenCalledWith("/ws", ["a.yaml"], "web", "restart", [".env"]);
    expect(run.mock.calls[0][0]).toMatchObject({ name: "web", detach: true });
    expect(build.mock.calls[0][0]).toMatchObject({ dockerfilePath: "Dockerfile.dev" });
  });

  it("uses safe defaults for actions, pruning and file listings", async () => {
    const action = vi.spyOn(commands, "dockerContainerAction").mockResolvedValue(null);
    const imageAction = vi.spyOn(commands, "dockerImageAction").mockResolvedValue("removed");
    const prune = vi.spyOn(commands, "dockerPruneResources").mockResolvedValue("pruned");
    const list = vi.spyOn(commands, "dockerListContainerFiles").mockResolvedValue([]);

    await expect(runDockerContainerAction("c1", "stop")).resolves.toBeUndefined();
    await runDockerImageAction("img", "remove");
    await pruneDockerResources("images");
    await listDockerContainerFiles("c1");

    expect(action).toHaveBeenCalledWith("c1", "stop", false);
    expect(imageAction).toHaveBeenCalledWith("img", "remove", false);
    expect(prune).toHaveBeenCalledWith("images", false);
    expect(list).toHaveBeenCalledWith("c1", "/");
  });

  it("orders copy arguments by direction", async () => {
    const from = vi.spyOn(commands, "dockerCopyFromContainer").mockResolvedValue("copied");
    const to = vi.spyOn(commands, "dockerCopyToContainer").mockResolvedValue("copied");

    await copyFromDockerContainer({ containerId: "c1", containerPath: "/app", hostPath: "/tmp" });
    await copyToDockerContainer({ containerId: "c1", hostPath: "/tmp/a", containerPath: "/app" });

    expect(from).toHaveBeenCalledWith("c1", "/app", "/tmp");
    expect(to).toHaveBeenCalledWith("c1", "/tmp/a", "/app");
  });

  it("fills missing env file keys and hides void results", async () => {
    vi.spyOn(commands, "dockerOpenEnvFile").mockResolvedValue({
      content: "A=1",
      file: { path: ".env", keys: null },
    } as never);
    vi.spyOn(commands, "dockerDeleteEnvFile").mockResolvedValue(null);
    vi.spyOn(commands, "dockerStopContainerLogStream").mockResolvedValue(null);

    const envFile = await openDockerEnvFile("/ws", ".env");

    expect(envFile.file.keys).toEqual([]);
    expect(envFile.content).toBe("A=1");
    await expect(deleteDockerEnvFile("/ws", ".env")).resolves.toBeUndefined();
    await expect(stopDockerContainerLogStream("s1")).resolves.toBeUndefined();
  });

  it("forwards native failures to the caller", async () => {
    vi.spyOn(commands, "dockerGetInventory").mockRejectedValue(new Error("daemon down"));
    vi.spyOn(commands, "dockerOpenDevContainer").mockRejectedValue(new Error("no config"));

    await expect(getDockerInventory()).rejects.toThrow("daemon down");
    await expect(openDockerDevContainer("/ws", ".devcontainer.json")).rejects.toThrow("no config");
  });

  it("saves project config for the workspace", async () => {
    const saved = { composeFiles: ["compose.yaml"] } as unknown as DockerProjectConfig;
    const save = vi.spyOn(commands, "dockerSaveProjectConfig").mockResolvedValue(saved as never);

    await expect(saveDockerProjectConfig("/ws", saved)).resolves.toBe(saved);
    expect(save).toHaveBeenCalledWith("/ws", saved);
  });
});
