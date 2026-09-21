export function getComposerTerminalCommand(input: string): string | null {
  const text = input.trimStart();
  return text.startsWith("!") ? text.slice(1).trim() : null;
}
