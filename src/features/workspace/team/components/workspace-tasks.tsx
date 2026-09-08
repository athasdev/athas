import { areProjectTabPathsEqual } from "@/features/window/utils/project-tab-path";
import { useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { resolveRunWorkingDirectory } from "@/features/run-actions/utils/run-action-discovery";
import { Button } from "@/ui/button";
import { Card, CardContent } from "@/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";
import { parseTeamWorkspace } from "../utils/team-workspace-config";
import type { WorkspaceSectionProps } from "./workspace-section-props";

export function WorkspaceTasks({ root, config, onChange, reportError }: WorkspaceSectionProps) {
  const activeRoot = useFileSystemStore((state) => state.rootFolderPath);
  const isActive = !!activeRoot && areProjectTabPathsEqual(activeRoot, root);
  const [lastStarted, setLastStarted] = useState<string | null>(null);
  const update = (index: number, patch: Partial<(typeof config.commands)[number]>) =>
    onChange({
      ...config,
      commands: config.commands.map((command, i) =>
        i === index ? { ...command, ...patch } : command,
      ),
    });
  const run = (index: number) => {
    try {
      if (!areProjectTabPathsEqual(useFileSystemStore.getState().rootFolderPath ?? "", root))
        throw new Error("Open this workspace before running its tasks.");
      const task = parseTeamWorkspace(JSON.stringify(config)).commands[index];
      if (!task) return;
      window.dispatchEvent(
        new CustomEvent("create-terminal-with-command", {
          detail: {
            name: task.name,
            command: task.command,
            workingDirectory: resolveRunWorkingDirectory(root, task.workingDirectory),
          },
        }),
      );
      setLastStarted(task.name);
    } catch (error) {
      reportError(error);
    }
  };
  return (
    <div className="space-y-5">
      <FieldDescription>
        Team tasks appear in Run Actions after saving. Run opens the command shown below in a
        terminal; output and process controls stay in that terminal.
      </FieldDescription>
      {!isActive ? (
        <p role="status" className="ui-text-sm text-muted-foreground">
          Open this workspace to run its tasks.
        </p>
      ) : null}
      {lastStarted ? (
        <p role="status" className="ui-text-sm text-muted-foreground">
          Opened {lastStarted} in a terminal.
        </p>
      ) : null}
      {!config.commands.length ? (
        <FieldDescription>
          No shared tasks yet. Add a development, test or build command for your team.
        </FieldDescription>
      ) : null}
      {config.commands.map((command, index) => (
        <Card key={index} variant="muted">
          <CardContent className="space-y-4">
            <div className="grid gap-4 @min-[700px]/workbench-content:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`task-name-${index}`}>Task name</FieldLabel>
                <Input
                  id={`task-name-${index}`}
                  value={command.name}
                  maxLength={120}
                  placeholder="Start development"
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`task-directory-${index}`}>Working directory</FieldLabel>
                <Input
                  id={`task-directory-${index}`}
                  value={command.workingDirectory ?? "."}
                  placeholder="apps/web"
                  onChange={(event) => update(index, { workingDirectory: event.target.value })}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`task-command-${index}`}>Command</FieldLabel>
              <Textarea
                id={`task-command-${index}`}
                rows={2}
                value={command.command}
                maxLength={4000}
                placeholder="bun run dev"
                onChange={(event) => update(index, { command: event.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                disabled={!isActive || !command.command.trim() || !command.name.trim()}
                onClick={() => run(index)}
              >
                Run task
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...config,
                    commands: config.commands.filter((entry, i) => i !== index),
                  })
                }
              >
                Remove task
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button
        disabled={config.commands.length >= 40}
        onClick={() =>
          onChange({
            ...config,
            commands: [...config.commands, { name: "", command: "", workingDirectory: "." }],
          })
        }
      >
        Add task
      </Button>
    </div>
  );
}
