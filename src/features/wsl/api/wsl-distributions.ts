import { commands } from "@/bindings/commands";

export const listWslDistributions = () => commands.wslListDistributions();

export const getWslHomeDirectory = (distribution: string) => commands.wslGetHomeDir(distribution);
