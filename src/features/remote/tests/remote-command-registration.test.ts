import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const mainRsPath = new URL("../../../../src-tauri/src/main.rs", import.meta.url);

const remoteInvokeCommands = [
  "store_remote_credential",
  "get_remote_credential",
  "remove_remote_credential",
  "ssh_connect",
  "ssh_disconnect",
  "ssh_disconnect_only",
  "ssh_create_file",
  "ssh_create_directory",
  "ssh_delete_path",
  "ssh_rename_path",
  "ssh_copy_path",
  "ssh_write_file",
  "ssh_read_directory",
  "ssh_read_file",
  "ssh_get_connected_ids",
  "create_remote_terminal",
  "remote_terminal_write",
  "remote_terminal_resize",
  "close_remote_terminal",
];

const wslInvokeCommands = [
  "wsl_list_distributions",
  "wsl_get_home_dir",
  "wsl_read_directory",
  "wsl_read_file",
  "wsl_read_file_bytes",
  "wsl_write_file",
  "wsl_create_file",
  "wsl_create_directory",
  "wsl_delete_path",
  "wsl_rename_path",
  "wsl_copy_path",
  "wsl_get_symlink_info",
  "wsl_resolve_windows_path",
];

describe("remote tauri command registration", () => {
  it("registers the full SSH remote command surface", () => {
    const mainRs = readFileSync(mainRsPath, "utf8");

    for (const command of remoteInvokeCommands) {
      expect(mainRs).toContain(command);
    }
  });

  it("registers the full WSL command surface", () => {
    const mainRs = readFileSync(mainRsPath, "utf8");

    for (const command of wslInvokeCommands) {
      expect(mainRs).toContain(command);
    }
  });
});
