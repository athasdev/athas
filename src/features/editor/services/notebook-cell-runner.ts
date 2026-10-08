import { commands } from "@/bindings/commands";

export const runPythonCell = (code: string, cwd: string | null, setupCode: string | null) =>
  commands.notebookRunPythonCell(code, cwd, setupCode);

export const runRCell = (code: string, cwd: string | null, setupCode: string | null) =>
  commands.notebookRunRCell(code, cwd, setupCode);
