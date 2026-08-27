import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { createNewDirectory } from "@/features/file-system/controllers/file-operations";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  ArrowLeftIcon as ArrowLeft,
  CodeIcon as Code,
  FolderOpenIcon as FolderOpen,
  FolderPlusIcon as FolderPlus,
  GitBranchIcon as GitBranch,
  PackageIcon as Package,
  RocketLaunchIcon as RocketLaunch,
  type Icon,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/ui/card";
import {
  CommandEmpty,
  CommandFooter,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { Empty, EmptyDescription } from "@/ui/empty";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/ui/field";
import Input from "@/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ui/input-group";
import Select from "@/ui/select";
import { Spinner } from "@/ui/spinner";
import {
  getNewProjectPath,
  getProjectNameError,
  getStarterCommand,
  inferProjectNameFromRepositoryUrl,
  type NewProjectSource,
  type ProjectPackageManager,
} from "../lib/new-project-model";

interface NewProjectContentProps {
  onBack: () => void;
  onClose: () => void;
}

interface ProjectSourceOption {
  id: NewProjectSource;
  label: string;
  description: string;
  badge: string;
  icon: Icon;
  keywords: string[];
}

const projectSourceOptions: ProjectSourceOption[] = [
  {
    id: "empty",
    label: "Empty Project",
    description: "Create a clean folder and start from scratch.",
    badge: "Built-in",
    icon: FolderPlus,
    keywords: ["blank", "folder", "local"],
  },
  {
    id: "nextjs",
    label: "Next.js",
    description: "App Router, TypeScript, Tailwind CSS, ESLint, and a src directory.",
    badge: "Web app",
    icon: RocketLaunch,
    keywords: ["react", "typescript", "tailwind", "frontend"],
  },
  {
    id: "vite-react",
    label: "Vite + React",
    description: "A lightweight React and TypeScript starter.",
    badge: "Web app",
    icon: Code,
    keywords: ["react", "typescript", "frontend"],
  },
  {
    id: "clone",
    label: "Clone Repository",
    description: "Clone an existing Git repository into a new local project.",
    badge: "Git",
    icon: GitBranch,
    keywords: ["github", "gitlab", "remote", "repository"],
  },
];

const packageManagerOptions = [
  { value: "npm", label: "npm" },
  { value: "pnpm", label: "pnpm" },
  { value: "bun", label: "Bun" },
];

function getCreationLabel(source: NewProjectSource) {
  if (source === "clone") return "Clone Repository";
  if (source === "empty") return "Create Project";
  return "Create & Install";
}

export default function NewProjectContent({ onBack, onClose }: NewProjectContentProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const repositoryInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"source" | "details" | "creating">("source");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [source, setSource] = useState<NewProjectSource>("empty");
  const [projectName, setProjectName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [locationPath, setLocationPath] = useState("");
  const [packageManager, setPackageManager] = useState<ProjectPackageManager>("npm");
  const [nameWasEdited, setNameWasEdited] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const handleOpenFolderByPath = useFileSystemStore((state) => state.handleOpenFolderByPath);

  useEffect(() => {
    void homeDir()
      .then(setLocationPath)
      .catch(() => setLocationPath(""));
  }, []);

  useEffect(() => {
    if (step !== "details") return;
    window.setTimeout(() => {
      if (source === "clone") {
        repositoryInputRef.current?.focus();
      } else {
        nameInputRef.current?.focus();
      }
    }, 0);
  }, [source, step]);

  const filteredSourceOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return projectSourceOptions;

    return projectSourceOptions.filter((option) =>
      [option.label, option.description, ...option.keywords].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const selectedSourceOption =
    projectSourceOptions.find((option) => option.id === source) ?? projectSourceOptions[0];
  const projectNameError = getProjectNameError(projectName);
  const destinationPath =
    locationPath.trim() && !projectNameError
      ? getNewProjectPath(locationPath, projectName)
      : locationPath.trim();
  const canCreate =
    !projectNameError &&
    !!locationPath.trim() &&
    (source !== "clone" || !!repositoryUrl.trim()) &&
    step === "details";

  const chooseSource = (nextSource: NewProjectSource) => {
    setSource(nextSource);
    setStep("details");
    setProjectName("");
    setRepositoryUrl("");
    setNameWasEdited(false);
    setErrorMessage("");
  };

  const handleSourceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (filteredSourceOptions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % filteredSourceOptions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex(
        (index) => (index - 1 + filteredSourceOptions.length) % filteredSourceOptions.length,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredSourceOptions[selectedIndex];
      if (option) chooseSource(option.id);
    }
  };

  const handleRepositoryUrlChange = (value: string) => {
    setRepositoryUrl(value);
    setErrorMessage("");
    if (!nameWasEdited) {
      setProjectName(inferProjectNameFromRepositoryUrl(value));
    }
  };

  const handleProjectNameChange = (value: string) => {
    setProjectName(value);
    setNameWasEdited(true);
    setErrorMessage("");
  };

  const handleChooseLocation = async () => {
    const selectedPath = await openFolder();
    if (selectedPath) {
      setLocationPath(selectedPath);
      setErrorMessage("");
    }
  };

  const returnToSource = () => {
    setStep("source");
    setQuery("");
    setErrorMessage("");
  };

  const createProject = async () => {
    if (!canCreate) return;

    setStep("creating");
    setErrorMessage("");

    try {
      if (await exists(destinationPath)) {
        throw new Error(`A file or folder already exists at ${destinationPath}.`);
      }

      if (source === "clone") {
        await invoke("git_clone", {
          repositoryUrl: repositoryUrl.trim(),
          destinationPath,
        });
      } else {
        await createNewDirectory(locationPath.trim(), projectName.trim());
      }

      const opened = await handleOpenFolderByPath(destinationPath);
      if (!opened) {
        throw new Error("The project was created but Athas could not open it.");
      }

      onClose();

      if (source === "nextjs" || source === "vite-react") {
        useBufferStore.getState().actions.openTerminalBuffer({
          command: getStarterCommand(source, packageManager),
          workingDirectory: destinationPath,
        });
      }
    } catch (error) {
      console.error("Failed to create project:", error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStep("details");
    }
  };

  if (step === "source") {
    return (
      <>
        <CommandHeader onClose={onClose}>
          <CommandHeaderAction type="button" aria-label="Back to projects" onClick={onBack}>
            <ArrowLeft />
          </CommandHeaderAction>
          <CommandInput
            value={query}
            onChange={setQuery}
            onKeyDown={handleSourceKeyDown}
            placeholder="Choose how to start..."
          />
        </CommandHeader>

        <CommandList>
          {filteredSourceOptions.length === 0 ? (
            <CommandEmpty>No project starters match "{query}".</CommandEmpty>
          ) : (
            filteredSourceOptions.map((option, index) => {
              const SourceIcon = option.icon;
              return (
                <CommandItemRow
                  key={option.id}
                  isSelected={selectedIndex === index}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => chooseSource(option.id)}
                  icon={<SourceIcon className="text-subtle-foreground" />}
                  title={option.label}
                  description={option.description}
                  accessory={<CommandItemBadge>{option.badge}</CommandItemBadge>}
                />
              );
            })
          )}
        </CommandList>
      </>
    );
  }

  const SourceIcon = selectedSourceOption.icon;

  if (step === "creating") {
    return (
      <>
        <CommandHeader onClose={onClose}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SourceIcon className="shrink-0 text-primary" />
            <span className="truncate font-sans ui-text-base font-medium text-foreground">
              {source === "clone" ? "Cloning Repository" : "Creating Project"}
            </span>
          </div>
        </CommandHeader>
        <Empty className="min-h-56 rounded-none px-6" role="status" aria-live="polite">
          <EmptyDescription>
            <Spinner
              label={source === "clone" ? "Cloning repository" : "Preparing project"}
              showLabel
              role={undefined}
            />
          </EmptyDescription>
          <EmptyDescription className="max-w-full truncate font-mono">
            {destinationPath}
          </EmptyDescription>
        </Empty>
      </>
    );
  }

  return (
    <>
      <CommandHeader onClose={onClose}>
        <CommandHeaderAction
          type="button"
          aria-label="Back to project starters"
          onClick={returnToSource}
        >
          <ArrowLeft />
        </CommandHeaderAction>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SourceIcon className="shrink-0 text-primary" />
          <span className="truncate font-sans ui-text-base font-medium text-foreground">
            {selectedSourceOption.label}
          </span>
        </div>
      </CommandHeader>

      <CommandList contentClassName="p-4">
        <form
          id="new-project-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createProject();
          }}
        >
          {source === "clone" ? (
            <Field>
              <FieldLabel htmlFor="new-project-repository">Repository URL</FieldLabel>
              <Input
                ref={repositoryInputRef}
                id="new-project-repository"
                value={repositoryUrl}
                onChange={(event) => handleRepositoryUrlChange(event.target.value)}
                placeholder="https://github.com/owner/repository.git"
              />
              <FieldDescription>HTTPS and SSH repository URLs are supported.</FieldDescription>
            </Field>
          ) : null}

          <Field data-invalid={Boolean(projectName && projectNameError)}>
            <FieldLabel htmlFor="new-project-name">Project Name</FieldLabel>
            <Input
              ref={nameInputRef}
              id="new-project-name"
              value={projectName}
              onChange={(event) => handleProjectNameChange(event.target.value)}
              placeholder={source === "clone" ? "repository" : "my-project"}
              aria-invalid={Boolean(projectName && projectNameError)}
            />
            {projectName && projectNameError ? <FieldError>{projectNameError}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="new-project-location">Location</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="new-project-location"
                value={locationPath}
                onChange={(event) => {
                  setLocationPath(event.target.value);
                  setErrorMessage("");
                }}
                placeholder="Choose a parent folder"
                className="font-mono"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  onClick={() => void handleChooseLocation()}
                  aria-label="Choose project location"
                >
                  <FolderOpen />
                  Browse
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>

          {source === "nextjs" || source === "vite-react" ? (
            <Field>
              <FieldLabel htmlFor="new-project-package-manager">Package Manager</FieldLabel>
              <Select
                id="new-project-package-manager"
                value={packageManager}
                options={packageManagerOptions}
                onChange={(value) => setPackageManager(value as ProjectPackageManager)}
              />
              <FieldDescription>
                Setup runs in the integrated terminal so you can follow its output.
              </FieldDescription>
            </Field>
          ) : null}

          {destinationPath ? (
            <Card variant="muted">
              <CardHeader>
                <CardTitle>Project location</CardTitle>
                <CardDescription className="break-all font-mono">{destinationPath}</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
        </form>
      </CommandList>

      <CommandFooter>
        <Button type="button" variant="ghost" onClick={returnToSource}>
          <ArrowLeft />
          Starters
        </Button>
        <div className="ml-auto">
          <Button type="submit" form="new-project-form" variant="accent" disabled={!canCreate}>
            {source === "clone" ? <GitBranch /> : source === "empty" ? <FolderPlus /> : <Package />}
            {getCreationLabel(source)}
          </Button>
        </div>
      </CommandFooter>
    </>
  );
}
