import { commands } from "@/bindings/commands";

export async function cloneRepository(url: string, destinationPath: string): Promise<void> {
  await commands.gitClone(url, destinationPath);
}
