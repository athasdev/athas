import { Code, Package, Palette, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { usePersistentSettingsStore } from "../settings/stores/persistent-settings-store";
import Button from "./ui/button";

interface Extension {
  id: string;
  name: string;
  description: string;
  category: "language-server" | "theme";
  status: "active" | "inactive";
  themeId?: string;
}

interface ExtensionsViewProps {
  onServerInstall: (server: Extension) => void;
  onServerUninstall: (serverId: string) => void;
  onThemeChange: (theme: string) => void;
  currentTheme: string;
}

const AVAILABLE_EXTENSIONS: Extension[] = [
  // Language Servers
  {
    id: "solargraph",
    name: "Solargraph",
    description: "Ruby language server with intelligent code completion",
    category: "language-server",
    status: "inactive",
  },
  {
    id: "typescript-language-server",
    name: "TypeScript Language Server",
    description: "TypeScript and JavaScript language server",
    category: "language-server",
    status: "inactive",
  },
  {
    id: "python-lsp-server",
    name: "Python LSP Server",
    description: "Python language server with code intelligence",
    category: "language-server",
    status: "inactive",
  },
  {
    id: "rust-analyzer",
    name: "rust-analyzer",
    description: "Rust language server with advanced features",
    category: "language-server",
    status: "inactive",
  },
  {
    id: "gopls",
    name: "gopls",
    description: "Go language server with code navigation",
    category: "language-server",
    status: "inactive",
  },
  {
    id: "clangd",
    name: "clangd",
    description: "C/C++ language server with diagnostics",
    category: "language-server",
    status: "inactive",
  },
];

interface ExtensionCardProps {
  extension: Extension;
  onToggle: () => void;
  isActive: boolean;
}

const ExtensionCard = ({ extension, onToggle, isActive }: ExtensionCardProps) => {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary-bg p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-text">{extension.name}</h3>
        <Button
          onClick={onToggle}
          variant={isActive ? "default" : "outline"}
          size="xs"
          className="font-normal text-xs opacity-80 hover:opacity-100"
        >
          {isActive ? "Disable" : "Enable"}
        </Button>
      </div>
      <p className="text-text-lighter text-xs">{extension.description}</p>
    </div>
  );
};

export default function ExtensionsView({
  onServerInstall,
  onServerUninstall,
  onThemeChange,
  currentTheme,
}: ExtensionsViewProps) {
  const { extensionsActiveTab, setExtensionsActiveTab } = usePersistentSettingsStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [extensions, setExtensions] = useState<Extension[]>(() => {
    // Initialize extensions with the current theme state
    return AVAILABLE_EXTENSIONS.map((ext) => ({
      ...ext,
      status: ext.category === "theme" && ext.themeId === currentTheme ? "active" : "inactive",
    }));
  });

  // Update extension states when currentTheme changes
  useEffect(() => {
    setExtensions((prev) =>
      prev.map((ext) => ({
        ...ext,
        status: ext.category === "theme" && ext.themeId === currentTheme ? "active" : "inactive",
      })),
    );
  }, [currentTheme]);

  const handleToggle = (extension: Extension) => {
    if (extension.category === "language-server") {
      if (extension.status === "inactive") {
        onServerInstall(extension);
      } else {
        onServerUninstall(extension.id);
      }
    } else if (extension.category === "theme") {
      // For themes, we just need to call onThemeChange
      // The status will be updated via the useEffect above
      onThemeChange(
        extension.status === "inactive"
          ? (extension.themeId as "auto" | "athas-light" | "athas-dark")
          : ("auto" as "auto" | "athas-light" | "athas-dark"),
      );
    }
  };

  const filteredExtensions = extensions.filter((extension) => {
    const matchesSearch =
      extension.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      extension.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = extensionsActiveTab === "all" || extension.category === extensionsActiveTab;
    return matchesSearch && matchesTab;
  });

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      <div className="flex items-center justify-between border-border border-b p-4">
        <h2 className="font-semibold text-lg text-text">Extensions</h2>
        <div className="relative w-64">
          <Search
            className="-translate-y-1/2 absolute top-1/2 left-2 transform text-text-lighter"
            size={16}
          />
          <input
            type="text"
            placeholder="Search extensions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full rounded border border-border bg-secondary-bg",
              "py-1.5 pr-4 pl-8 text-text text-xs placeholder-text-lighter",
              "focus:border-accent focus:outline-none",
            )}
          />
        </div>
      </div>

      <div className="flex gap-2 p-4">
        <Button
          onClick={() => setExtensionsActiveTab("all")}
          variant="ghost"
          size="sm"
          data-active={extensionsActiveTab === "all"}
          className={cn(
            "text-xs",
            extensionsActiveTab === "all"
              ? "bg-selected text-text"
              : "bg-transparent text-text-lighter hover:bg-hover",
          )}
        >
          All
        </Button>
        <Button
          onClick={() => setExtensionsActiveTab("language-server")}
          variant="ghost"
          size="sm"
          data-active={extensionsActiveTab === "language-server"}
          className={cn(
            "flex items-center gap-1 text-xs",
            extensionsActiveTab === "language-server"
              ? "bg-selected text-text"
              : "bg-transparent text-text-lighter hover:bg-hover",
          )}
        >
          <Code size={14} />
          Language Servers
        </Button>
        <Button
          onClick={() => setExtensionsActiveTab("theme")}
          variant="ghost"
          size="sm"
          data-active={extensionsActiveTab === "theme"}
          className={cn(
            "flex items-center gap-1 text-xs",
            extensionsActiveTab === "theme"
              ? "bg-selected text-text"
              : "bg-transparent text-text-lighter hover:bg-hover",
          )}
        >
          <Palette size={14} />
          Themes
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Extensions */}
        {extensionsActiveTab !== "theme" && (
          <div>
            {extensionsActiveTab === "all" && filteredExtensions.length > 0 && (
              <h3 className="mb-3 flex items-center gap-2 font-medium text-sm text-text">
                <Package size={16} />
                Extensions
              </h3>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredExtensions.map((extension) => (
                <ExtensionCard
                  key={extension.id}
                  extension={extension}
                  onToggle={() => handleToggle(extension)}
                  isActive={extension.status === "active"}
                />
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {filteredExtensions.length === 0 && (
          <div className="py-8 text-center text-text-lighter">
            <Package size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No items found matching your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}
