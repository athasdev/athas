import { Code, Package, Palette, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { CoreFeature } from "../types/core-features";
import type { ThemeType } from "../types/theme";
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
  onThemeChange: (theme: ThemeType) => void;
  currentTheme: ThemeType;
  coreFeatures?: CoreFeature[];
  onCoreFeatureToggle?: (featureId: string, enabled: boolean) => void;
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
  // Updated Themes
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    description: "Dark and warm flavor of Catppuccin",
    category: "theme",
    status: "inactive",
    themeId: "catppuccin-mocha",
  },
  {
    id: "catppuccin-macchiato",
    name: "Catppuccin Macchiato",
    description: "Balanced dark flavor of Catppuccin",
    category: "theme",
    status: "inactive",
    themeId: "catppuccin-macchiato",
  },
  {
    id: "catppuccin-frappe",
    name: "Catppuccin Frappé",
    description: "Light dark flavor of Catppuccin",
    category: "theme",
    status: "inactive",
    themeId: "catppuccin-frappe",
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    description: "Light and creamy flavor of Catppuccin",
    category: "theme",
    status: "inactive",
    themeId: "catppuccin-latte",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Dark and elegant theme inspired by Tokyo",
    category: "theme",
    status: "inactive",
    themeId: "tokyo-night",
  },
  {
    id: "tokyo-night-storm",
    name: "Tokyo Night Storm",
    description: "Stormy variant of Tokyo Night",
    category: "theme",
    status: "inactive",
    themeId: "tokyo-night-storm",
  },
  {
    id: "tokyo-night-light",
    name: "Tokyo Night Light",
    description: "Light variant of Tokyo Night",
    category: "theme",
    status: "inactive",
    themeId: "tokyo-night-light",
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "Dark theme with vivid highlights",
    category: "theme",
    status: "inactive",
    themeId: "dracula",
  },
  {
    id: "dracula-soft",
    name: "Dracula Soft",
    description: "Softer variant of Dracula",
    category: "theme",
    status: "inactive",
    themeId: "dracula-soft",
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic-inspired cool color palette",
    category: "theme",
    status: "inactive",
    themeId: "nord",
  },
  {
    id: "nord-light",
    name: "Nord Light",
    description: "Light variant of Nord theme",
    category: "theme",
    status: "inactive",
    themeId: "nord-light",
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    description: "Official GitHub dark theme",
    category: "theme",
    status: "inactive",
    themeId: "github-dark",
  },
  {
    id: "github-dark-dimmed",
    name: "GitHub Dark Dimmed",
    description: "Dimmed variant of GitHub dark",
    category: "theme",
    status: "inactive",
    themeId: "github-dark-dimmed",
  },
  {
    id: "github-light",
    name: "GitHub Light",
    description: "Official GitHub light theme",
    category: "theme",
    status: "inactive",
    themeId: "github-light",
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    description: "Enhanced Atom One Dark theme",
    category: "theme",
    status: "inactive",
    themeId: "one-dark-pro",
  },
  {
    id: "one-light-pro",
    name: "One Light Pro",
    description: "Light variant of One Dark Pro",
    category: "theme",
    status: "inactive",
    themeId: "one-light-pro",
  },
  {
    id: "material-deep-ocean",
    name: "Material Deep Ocean",
    description: "Deep blue material design theme",
    category: "theme",
    status: "inactive",
    themeId: "material-deep-ocean",
  },
  {
    id: "material-palenight",
    name: "Material Palenight",
    description: "Elegant purple-based material theme",
    category: "theme",
    status: "inactive",
    themeId: "material-palenight",
  },

  {
    id: "material-lighter",
    name: "Material Lighter",
    description: "Light variant of Material theme",
    category: "theme",
    status: "inactive",
    themeId: "material-lighter",
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    description: "Dark retro groove theme",
    category: "theme",
    status: "inactive",
    themeId: "gruvbox-dark",
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    description: "Light retro groove theme",
    category: "theme",
    status: "inactive",
    themeId: "gruvbox-light",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    description: "Dark precision colors theme",
    category: "theme",
    status: "inactive",
    themeId: "solarized-dark",
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    description: "Light precision colors theme",
    category: "theme",
    status: "inactive",
    themeId: "solarized-light",
  },
  {
    id: "synthwave-84",
    name: "SynthWave 84",
    description: "Retro synthwave-inspired theme",
    category: "theme",
    status: "inactive",
    themeId: "synthwave-84",
  },
  {
    id: "monokai-pro",
    name: "Monokai Pro",
    description: "Professional Monokai theme",
    category: "theme",
    status: "inactive",
    themeId: "monokai-pro",
  },
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    description: "Dark variant of Ayu theme",
    category: "theme",
    status: "inactive",
    themeId: "ayu-dark",
  },
  {
    id: "ayu-mirage",
    name: "Ayu Mirage",
    description: "Mirage variant of Ayu theme",
    category: "theme",
    status: "inactive",
    themeId: "ayu-mirage",
  },
  {
    id: "ayu-light",
    name: "Ayu Light",
    description: "Light variant of Ayu theme",
    category: "theme",
    status: "inactive",
    themeId: "ayu-light",
  },
  {
    id: "vercel-dark",
    name: "Vercel Dark",
    description: "Clean dark theme inspired by Vercel design",
    category: "theme",
    status: "inactive",
    themeId: "vercel-dark",
  },
  {
    id: "vesper",
    name: "Vesper",
    description: "Dark theme with deep oranges and greens",
    category: "theme",
    status: "inactive",
    themeId: "vesper",
  },
  {
    id: "aura",
    name: "Aura",
    description: "A beautiful dark theme with purple and green",
    category: "theme",
    status: "inactive",
    themeId: "aura",
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

interface CoreFeatureCardProps {
  feature: CoreFeature;
  onToggle: () => void;
}

const CoreFeatureCard = ({ feature, onToggle }: CoreFeatureCardProps) => {
  const Icon = feature.icon;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary-bg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-text-lighter" />
          <h3 className="font-medium text-sm text-text">{feature.name}</h3>
        </div>
        <Button
          onClick={onToggle}
          variant={feature.enabled ? "default" : "outline"}
          size="xs"
          className="font-normal text-xs opacity-80 hover:opacity-100"
        >
          {feature.enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>
      <p className="text-text-lighter text-xs">{feature.description}</p>
    </div>
  );
};

export default function ExtensionsView({
  onServerInstall,
  onServerUninstall,
  onThemeChange,
  currentTheme,
  coreFeatures,
  onCoreFeatureToggle,
}: ExtensionsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "core" | "language-server" | "theme">("all");
  const [extensions, setExtensions] = useState<Extension[]>(() => {
    // Initialize extensions with the current theme state
    return AVAILABLE_EXTENSIONS.map(ext => ({
      ...ext,
      status: ext.category === "theme" && ext.themeId === currentTheme ? "active" : "inactive",
    }));
  });

  // Update extension states when currentTheme changes
  useEffect(() => {
    setExtensions(prev =>
      prev.map(ext => ({
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
        extension.status === "inactive" ? (extension.themeId as ThemeType) : ("auto" as ThemeType),
      );
    }
  };

  const filteredExtensions = extensions.filter(extension => {
    const matchesSearch =
      extension.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      extension.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === "all" || extension.category === activeTab;
    return matchesSearch && matchesTab;
  });

  const filteredCoreFeatures =
    coreFeatures?.filter(feature => {
      const matchesSearch =
        feature.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        feature.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    }) || [];

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
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded border border-border bg-secondary-bg py-1.5 pr-4 pl-8 text-text text-xs placeholder-text-lighter focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex gap-2 p-4 ">
        <Button
          onClick={() => setActiveTab("all")}
          variant="ghost"
          size="sm"
          data-active={activeTab === "all"}
          className={`text-xs ${activeTab === "all" ? "bg-hover" : ""}`}
        >
          All
        </Button>
        <Button
          onClick={() => setActiveTab("core")}
          variant="ghost"
          size="sm"
          data-active={activeTab === "core"}
          className={`flex items-center gap-1 text-xs ${activeTab === "core" ? "bg-hover" : ""}`}
        >
          <Settings size={14} />
          Core
        </Button>
        <Button
          onClick={() => setActiveTab("language-server")}
          variant="ghost"
          size="sm"
          data-active={activeTab === "language-server"}
          className={`flex items-center gap-1 text-xs ${activeTab === "language-server" ? "bg-hover" : ""}`}
        >
          <Code size={14} />
          Language Servers
        </Button>
        <Button
          onClick={() => setActiveTab("theme")}
          variant="ghost"
          size="sm"
          data-active={activeTab === "theme"}
          className={`flex items-center gap-1 text-xs ${activeTab === "theme" ? "bg-hover" : ""}`}
        >
          <Palette size={14} />
          Themes
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Core Features */}
        {(activeTab === "all" || activeTab === "core") &&
          coreFeatures &&
          coreFeatures.length > 0 && (
            <div className="mb-6">
              {activeTab === "all" && (
                <h3 className="mb-3 flex items-center gap-2 font-medium text-sm text-text">
                  <Settings size={16} />
                  Core Features
                </h3>
              )}
              <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredCoreFeatures.map(feature => (
                  <CoreFeatureCard
                    key={feature.id}
                    feature={feature}
                    onToggle={() => onCoreFeatureToggle?.(feature.id, !feature.enabled)}
                  />
                ))}
              </div>
            </div>
          )}

        {/* Extensions */}
        {activeTab !== "core" && (
          <div>
            {activeTab === "all" && filteredExtensions.length > 0 && (
              <h3 className="mb-3 flex items-center gap-2 font-medium text-sm text-text">
                <Package size={16} />
                Extensions
              </h3>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredExtensions.map(extension => (
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
        {((activeTab === "core" && filteredCoreFeatures.length === 0) ||
          (activeTab !== "core" && activeTab !== "all" && filteredExtensions.length === 0) ||
          (activeTab === "all" &&
            filteredCoreFeatures.length === 0 &&
            filteredExtensions.length === 0)) && (
          <div className="py-8 text-center text-text-lighter">
            <Package size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No items found matching your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}
