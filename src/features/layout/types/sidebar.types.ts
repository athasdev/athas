export type SidebarView =
  | "files"
  | "git"
  | "github-prs"
  | "workspaces"
  | "docker"
  | "databases"
  | "collaboration"
  | (string & {});
