import type { ReactNode } from "react";

export interface UIExtensionRegistration {
  extensionId: string;
  manifestId: string;
  name?: string;
  description?: string;
  contributionType?: "sidebar" | "toolbar" | "command";
  state: "loading" | "active" | "error" | "disabled";
  error?: string;
}

export interface RegisteredSidebarView {
  id: string;
  extensionId: string;
  title: string;
  icon: string;
  render: () => ReactNode;
  order?: number;
}

export interface RegisteredToolbarAction {
  id: string;
  extensionId: string;
  title: string;
  icon: string;
  position: "left" | "right";
  onClick: () => void;
  isVisible?: () => boolean;
}

export interface RegisteredCommand {
  id: string;
  extensionId: string;
  title: string;
  category?: string;
  execute: (...args: unknown[]) => void | Promise<void>;
}

export interface ExtensionDialog {
  id: string;
  extensionId: string;
  title: string;
  render: () => ReactNode;
  width?: number;
  height?: number;
}

export interface Disposable {
  dispose: () => void;
}
