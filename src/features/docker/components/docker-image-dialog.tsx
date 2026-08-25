import type { Dispatch, SetStateAction } from "react";
import { PlayIcon as Play, StackIcon as ImageIcon } from "@/ui/icons";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";
import { DockerCapabilityNotice } from "./docker-sidebar-states";

export type DockerImageDialogMode = "build" | "run";

export interface DockerBuildDraft {
  contextPath: string;
  dockerfilePath: string;
  tag: string;
  buildArgs: string;
}

export interface DockerRunDraft {
  image: string;
  name: string;
  ports: string;
  volumes: string;
  env: string;
  envFiles: string;
  command: string;
}

interface DockerImageDialogProps {
  mode: DockerImageDialogMode;
  buildDraft: DockerBuildDraft;
  runDraft: DockerRunDraft;
  hasWorkspace: boolean;
  isDockerDaemonReady: boolean;
  connectionError: string | null;
  setBuildDraft: Dispatch<SetStateAction<DockerBuildDraft>>;
  setRunDraft: Dispatch<SetStateAction<DockerRunDraft>>;
  onClose: () => void;
  onSaveBuildPreset: () => void | Promise<void>;
  onSaveRunPreset: () => void | Promise<void>;
  onBuild: () => void | Promise<void>;
  onRun: () => void | Promise<void>;
}

export function DockerImageDialog({
  mode,
  buildDraft,
  runDraft,
  hasWorkspace,
  isDockerDaemonReady,
  connectionError,
  setBuildDraft,
  setRunDraft,
  onClose,
  onSaveBuildPreset,
  onSaveRunPreset,
  onBuild,
  onRun,
}: DockerImageDialogProps) {
  return (
    <Dialog
      title={mode === "build" ? "Build Docker Image" : "Run Docker Image"}
      icon={mode === "build" ? ImageIcon : Play}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {mode === "build" ? (
            <>
              <Button
                variant="ghost"
                onClick={() => void onSaveBuildPreset()}
                disabled={!hasWorkspace || !buildDraft.contextPath.trim()}
              >
                Save Preset
              </Button>
              <Button
                onClick={() => void onBuild()}
                disabled={!isDockerDaemonReady || !buildDraft.contextPath.trim()}
              >
                Build
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => void onSaveRunPreset()}
                disabled={!hasWorkspace || !runDraft.image.trim()}
              >
                Save Preset
              </Button>
              <Button
                onClick={() => void onRun()}
                disabled={!isDockerDaemonReady || !runDraft.image.trim()}
              >
                Run
              </Button>
            </>
          )}
        </>
      }
    >
      {connectionError ? (
        <DockerCapabilityNotice className="mx-0 mb-3">
          Start Docker before {mode === "build" ? "building this image" : "running this image"}. You
          can still save these values as a preset.
        </DockerCapabilityNotice>
      ) : null}
      {mode === "build" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="docker-build-context" className="ui-text-sm block text-foreground">
              Context Path
            </label>
            <Input
              id="docker-build-context"
              value={buildDraft.contextPath}
              onChange={(event) =>
                setBuildDraft((current) => ({
                  ...current,
                  contextPath: event.target.value,
                }))
              }
              placeholder="/path/to/project"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="docker-build-file" className="ui-text-sm block text-foreground">
              Dockerfile
            </label>
            <Input
              id="docker-build-file"
              value={buildDraft.dockerfilePath}
              onChange={(event) =>
                setBuildDraft((current) => ({
                  ...current,
                  dockerfilePath: event.target.value,
                }))
              }
              placeholder="/path/to/Dockerfile"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="docker-build-tag" className="ui-text-sm block text-foreground">
              Tag
            </label>
            <Input
              id="docker-build-tag"
              value={buildDraft.tag}
              onChange={(event) =>
                setBuildDraft((current) => ({ ...current, tag: event.target.value }))
              }
              placeholder="my-app:latest"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="docker-build-args" className="ui-text-sm block text-foreground">
              Build Args
            </label>
            <Textarea
              id="docker-build-args"
              value={buildDraft.buildArgs}
              onChange={(event) =>
                setBuildDraft((current) => ({
                  ...current,
                  buildArgs: event.target.value,
                }))
              }
              placeholder="NODE_ENV=production"
              className="min-h-20 font-mono"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="docker-run-image" className="ui-text-sm block text-foreground">
              Image
            </label>
            <Input
              id="docker-run-image"
              value={runDraft.image}
              onChange={(event) =>
                setRunDraft((current) => ({ ...current, image: event.target.value }))
              }
              placeholder="nginx:latest"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="docker-run-name" className="ui-text-sm block text-foreground">
              Container Name
            </label>
            <Input
              id="docker-run-name"
              value={runDraft.name}
              onChange={(event) =>
                setRunDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="my-container"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="docker-run-ports" className="ui-text-sm block text-foreground">
                Ports
              </label>
              <Textarea
                id="docker-run-ports"
                value={runDraft.ports}
                onChange={(event) =>
                  setRunDraft((current) => ({ ...current, ports: event.target.value }))
                }
                placeholder="8080:80"
                className="min-h-20 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="docker-run-volumes" className="ui-text-sm block text-foreground">
                Volumes
              </label>
              <Textarea
                id="docker-run-volumes"
                value={runDraft.volumes}
                onChange={(event) =>
                  setRunDraft((current) => ({ ...current, volumes: event.target.value }))
                }
                placeholder="/host:/container"
                className="min-h-20 font-mono"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="docker-run-env" className="ui-text-sm block text-foreground">
              Environment
            </label>
            <Textarea
              id="docker-run-env"
              value={runDraft.env}
              onChange={(event) =>
                setRunDraft((current) => ({ ...current, env: event.target.value }))
              }
              placeholder="KEY=value"
              className="min-h-20 font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="docker-run-env-files" className="ui-text-sm block text-foreground">
              Env Files
            </label>
            <Textarea
              id="docker-run-env-files"
              value={runDraft.envFiles}
              onChange={(event) =>
                setRunDraft((current) => ({ ...current, envFiles: event.target.value }))
              }
              placeholder=".env"
              className="min-h-16 font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="docker-run-command" className="ui-text-sm block text-foreground">
              Command
            </label>
            <Input
              id="docker-run-command"
              value={runDraft.command}
              onChange={(event) =>
                setRunDraft((current) => ({ ...current, command: event.target.value }))
              }
              placeholder="npm start"
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}
