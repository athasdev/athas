import { commands } from "@/bindings/commands";

export const isCliInstalled = () => commands.checkCliInstalled();

export const installCli = () => commands.installCliCommand();

export const uninstallCli = () => commands.uninstallCliCommand();

export const getCliInstallCommand = () => commands.getCliInstallCommand();
