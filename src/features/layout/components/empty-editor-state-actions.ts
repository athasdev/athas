export type EmptyEditorPrimaryActionId = "folder" | "file" | "terminal" | "agent" | "web";
export type EmptyEditorContextActionId =
  | "open-folder"
  | "open-file"
  | "new-terminal"
  | "new-agent"
  | "open-url";
export type EmptyEditorActionId = EmptyEditorPrimaryActionId | EmptyEditorContextActionId;

export interface EmptyEditorActionDescriptor<TActionId extends EmptyEditorActionId> {
  id: TActionId;
  label: string;
}

export const EMPTY_EDITOR_PRIMARY_ACTIONS: EmptyEditorActionDescriptor<EmptyEditorPrimaryActionId>[] =
  [
    { id: "folder", label: "Open Folder" },
    { id: "file", label: "Open File" },
    { id: "terminal", label: "New Terminal" },
    { id: "agent", label: "Open Harness" },
    { id: "web", label: "Open URL" },
  ];

export const EMPTY_EDITOR_CONTEXT_ACTIONS: EmptyEditorActionDescriptor<EmptyEditorContextActionId>[] =
  [
    { id: "open-folder", label: "Open Folder" },
    { id: "open-file", label: "Open File" },
    { id: "new-terminal", label: "New Terminal" },
    { id: "new-agent", label: "Open Harness" },
    { id: "open-url", label: "Open URL" },
  ];
