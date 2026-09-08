export interface TeamWorkspaceCommand {
  name: string;
  command: string;
  workingDirectory?: string;
}

export interface TeamWorkspaceRepository {
  id: string;
  name: string;
  url?: string;
}

export interface TeamWorkspace {
  version: 1;
  name: string;
  instructions: string;
  commands: TeamWorkspaceCommand[];
  description?: string;
  repositories?: TeamWorkspaceRepository[];
  recommendedExtensions?: string[];
}
