import { getVisibleIconThemes } from "@/extensions/icon-themes/icon-theme-normalization";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { bundledExtensionManifests } from "@/extensions/bundled/bundled-extension-manifests";
import type { AvailableExtension } from "@/extensions/registry/extension-store-types";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import {
  getManifestAIProviderContributions,
  getManifestDatabaseContributions,
  getManifestIconContributions,
  getManifestIntegrationContributions,
  getManifestThemeContributions,
} from "@/extensions/types/extension-contributions";
import { isMarketplaceSkillInstalled } from "@/features/ai/lib/skill-library";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import { getCatalogIconUrl, resolveManifestIcon } from "./extension-catalog-icon";
import type { UnifiedExtension } from "./extension-catalog-types";
import { isBuiltInDatabaseProvider, resolvePackageSize } from "./extension-catalog-utils";

export function buildExtensionCatalog({
  availableExtensions,
  agents,
  marketplaceSkills,
  aiSkills,
  selectedThemeId,
  selectedIconThemeId,
}: {
  availableExtensions: Map<string, AvailableExtension>;
  agents: AgentConfig[];
  marketplaceSkills: MarketplaceSkill[];
  aiSkills: AIChatSkill[];
  selectedThemeId: string;
  selectedIconThemeId: string;
}): UnifiedExtension[] {
  const allExtensions: UnifiedExtension[] = [];
  const detectedAgents = new Map(agents.map((agent) => [agent.id, agent]));

  for (const [, ext] of availableExtensions) {
    if (ext.manifest.agents && ext.manifest.agents.length > 0) {
      const contribution = ext.manifest.agents[0];
      const agent = detectedAgents.get(contribution.id);
      allExtensions.push({
        id: `agent:${contribution.id}`,
        name: agent?.name ?? contribution.name,
        description:
          agent?.description ?? contribution.description ?? "ACP-compatible coding agent",
        category: "agent",
        isInstalled: agent?.installed ?? false,
        isEnabled: agent?.installed ?? false,
        version: ext.manifest.version,
        extensions: [agent?.binaryName ?? contribution.binaryName],
        publisher: ext.manifest.publisher,
        isMarketplace: true,
        isBundled: false,
        runtimeIssues: ext.runtimeIssues,
        agentId: contribution.id,
        icon: resolveManifestIcon(
          agent?.icon ?? contribution.icon ?? ext.manifest.icon,
          contribution.id,
          agent?.id,
          agent?.name,
          contribution.name,
          contribution.binaryName,
          ext.manifest.displayName,
        ),
        canInstall: agent?.canInstall ?? Boolean(contribution.install),
        contributionSummary: [
          `agent:${contribution.id}`,
          agent?.binaryName ?? contribution.binaryName,
        ].filter(Boolean),
      });
    }

    if (ext.manifest.languages && ext.manifest.languages.length > 0) {
      const lang = ext.manifest.languages[0];
      const isBundled = !ext.manifest.installation;
      allExtensions.push({
        id: ext.manifest.id,
        name: ext.manifest.displayName,
        description: ext.manifest.description,
        category: "language",
        isInstalled: ext.isInstalled,
        isEnabled: ext.isEnabled,
        version: ext.manifest.version,
        extensions: lang.extensions.map((e: string) => e.replace(".", "")),
        publisher: ext.manifest.publisher,
        isMarketplace: !isBundled,
        isBundled,
        icon: resolveManifestIcon(
          ext.manifest.icon,
          lang.id,
          lang.aliases?.[0],
          lang.extensions[0],
          ext.manifest.displayName,
          ext.manifest.name,
        ),
        runtimeIssues: ext.runtimeIssues,
        packageSize: resolvePackageSize(ext.manifest),
        contributionSummary: [
          ...ext.manifest.languages.map((language) => `language:${language.id}`),
          ...(ext.manifest.lsp?.name ? [`lsp:${ext.manifest.lsp.name}`] : []),
          ...(ext.manifest.formatter?.name ? [`formatter:${ext.manifest.formatter.name}`] : []),
          ...(ext.manifest.linter?.name ? [`linter:${ext.manifest.linter.name}`] : []),
        ],
      });
    }

    const databaseContributions = getManifestDatabaseContributions(ext.manifest);
    if (databaseContributions.length > 0) {
      const provider = databaseContributions[0];
      const isBuiltInDatabase = isBuiltInDatabaseProvider(provider.id);
      allExtensions.push({
        id: ext.manifest.id,
        name: ext.manifest.displayName,
        description: ext.manifest.description,
        category: "database",
        isInstalled: ext.isInstalled,
        isEnabled: ext.isEnabled,
        version: ext.manifest.version,
        extensions: provider.fileExtensions?.map((item) => item.replace(".", "")),
        publisher: ext.manifest.publisher,
        isMarketplace: !isBuiltInDatabase,
        isBundled: isBuiltInDatabase,
        icon: resolveManifestIcon(
          ext.manifest.icon,
          provider.id,
          provider.label,
          ext.manifest.displayName,
        ),
        runtimeIssues: ext.runtimeIssues,
        packageSize: resolvePackageSize(ext.manifest),
        contributionSummary: [`database:${provider.id}`],
      });
    }

    const themeContributions = getManifestThemeContributions(ext.manifest);
    if (themeContributions.length > 0) {
      const themeIds = themeContributions.map((theme) => theme.id);
      const activeThemeId = themeIds.find((candidate) => candidate === selectedThemeId);
      const extensionThemeId = activeThemeId ?? themeIds[0] ?? ext.manifest.id;
      allExtensions.push({
        id: ext.manifest.id,
        name: ext.manifest.displayName,
        description: ext.manifest.description,
        category: "theme",
        isInstalled: ext.isInstalled,
        isActive: ext.isEnabled && Boolean(activeThemeId),
        isEnabled: ext.isEnabled,
        version: ext.manifest.version,
        publisher: ext.manifest.publisher,
        isMarketplace: true,
        isBundled: false,
        icon: resolveManifestIcon(
          ext.manifest.icon,
          activeThemeId,
          themeContributions[0]?.id,
          themeContributions[0]?.name,
          ext.manifest.displayName,
          "theme",
        ),
        runtimeIssues: ext.runtimeIssues,
        packageSize: resolvePackageSize(ext.manifest),
        selectionId: extensionThemeId,
        appearanceOptions: themeContributions.map((theme) => ({
          id: theme.id,
          name: theme.name,
          description: theme.description,
        })),
        contributionSummary: themeContributions.map((theme) => `theme:${theme.id}`),
      });
    }

    const iconContributions = getManifestIconContributions(ext.manifest);
    if (iconContributions.length > 0) {
      const iconThemeIds = iconContributions.map((theme) => theme.id);
      const activeIconThemeId = iconThemeIds.find((candidate) => candidate === selectedIconThemeId);
      const extensionIconThemeId = activeIconThemeId ?? iconThemeIds[0] ?? ext.manifest.id;
      allExtensions.push({
        id: ext.manifest.id,
        name: ext.manifest.displayName,
        description: ext.manifest.description,
        category: "icon-theme",
        isInstalled: ext.isInstalled,
        isActive: ext.isEnabled && Boolean(activeIconThemeId),
        isEnabled: ext.isEnabled,
        version: ext.manifest.version,
        publisher: ext.manifest.publisher,
        isMarketplace: true,
        isBundled: false,
        icon: resolveManifestIcon(
          ext.manifest.icon,
          iconContributions[0]?.id,
          iconContributions[0]?.name,
          ext.manifest.displayName,
          "icon-theme",
        ),
        runtimeIssues: ext.runtimeIssues,
        packageSize: resolvePackageSize(ext.manifest),
        selectionId: extensionIconThemeId,
        appearanceOptions: iconContributions.map((theme) => ({
          id: theme.id,
          name: theme.name,
          description: theme.description,
        })),
        contributionSummary: iconContributions.map((theme) => `icon:${theme.id}`),
      });
    }

    const aiProviderContributions = getManifestAIProviderContributions(ext.manifest);
    if (aiProviderContributions.length > 0) {
      allExtensions.push({
        id: ext.manifest.id,
        name: ext.manifest.displayName,
        description: ext.manifest.description,
        category: "ai",
        isInstalled: ext.isInstalled,
        isEnabled: ext.isEnabled,
        version: ext.manifest.version,
        publisher: ext.manifest.publisher,
        isMarketplace: true,
        isBundled: false,
        icon: resolveManifestIcon(
          ext.manifest.icon,
          aiProviderContributions[0]?.id,
          aiProviderContributions[0]?.name,
          ext.manifest.displayName,
        ),
        runtimeIssues: ext.runtimeIssues,
        packageSize: resolvePackageSize(ext.manifest),
        contributionSummary: aiProviderContributions.map((provider) => `provider:${provider.id}`),
      });
    }

    const integrationContributions = getManifestIntegrationContributions(ext.manifest);
    if (integrationContributions.length > 0) {
      const integration = integrationContributions[0];
      allExtensions.push({
        id: ext.manifest.id,
        name: ext.manifest.displayName,
        description: ext.manifest.description,
        category: "integration",
        isInstalled: ext.isInstalled,
        isEnabled: ext.isEnabled,
        version: ext.manifest.version,
        publisher: ext.manifest.publisher,
        isMarketplace: true,
        isBundled: false,
        icon: resolveManifestIcon(
          ext.manifest.icon,
          integration.icon,
          integration.id,
          integration.name,
        ),
        runtimeIssues: ext.runtimeIssues,
        packageSize: resolvePackageSize(ext.manifest),
        contributionSummary: integrationContributions.map((item) => `integration:${item.id}`),
      });
    }
  }

  themeRegistry.getAllThemes().forEach((theme) => {
    if (themeRegistry.getThemeSource(theme.id)) {
      return;
    }

    allExtensions.push({
      id: theme.id,
      name: theme.name,
      description: theme.description || `${theme.category} theme`,
      category: "theme",
      isInstalled: true,
      isEnabled: true,
      isActive: selectedThemeId === theme.id,
      version: "1.0.0",
      icon: getCatalogIconUrl(theme.id, theme.name, "theme"),
      selectionId: theme.id,
      appearanceOptions: [
        {
          id: theme.id,
          name: theme.name,
          description: theme.description,
        },
      ],
    });
  });

  const catalogedIconThemeIds = new Set(
    allExtensions
      .filter((extension) => extension.category === "icon-theme")
      .flatMap(
        (extension) =>
          extension.appearanceOptions?.map((option) => option.id) ??
          (extension.selectionId ? [extension.selectionId] : []),
      ),
  );

  for (const { manifest } of bundledExtensionManifests) {
    const iconContributions = getManifestIconContributions(manifest).filter(
      (contribution) => !catalogedIconThemeIds.has(contribution.id),
    );
    if (iconContributions.length === 0) {
      continue;
    }

    const activeIconThemeId = iconContributions.find(
      (contribution) => contribution.id === selectedIconThemeId,
    )?.id;
    const extensionIconThemeId = activeIconThemeId ?? iconContributions[0]?.id ?? manifest.id;

    allExtensions.push({
      id: manifest.id,
      name: manifest.displayName,
      description: manifest.description,
      category: "icon-theme",
      isInstalled: true,
      isActive: Boolean(activeIconThemeId),
      isEnabled: true,
      version: manifest.version,
      publisher: manifest.publisher,
      isMarketplace: false,
      isBundled: true,
      icon: resolveManifestIcon(
        manifest.icon,
        iconContributions[0]?.id,
        iconContributions[0]?.name,
        manifest.displayName,
        "icon-theme",
      ),
      selectionId: extensionIconThemeId,
      appearanceOptions: iconContributions.map((theme) => ({
        id: theme.id,
        name: theme.name,
        description: theme.description,
      })),
      contributionSummary: iconContributions.map((theme) => `icon:${theme.id}`),
    });

    for (const contribution of iconContributions) {
      catalogedIconThemeIds.add(contribution.id);
    }
  }

  getVisibleIconThemes(iconThemeRegistry.getAllThemes()).forEach((iconTheme) => {
    if (catalogedIconThemeIds.has(iconTheme.id) || iconThemeRegistry.getThemeSource(iconTheme.id)) {
      return;
    }

    allExtensions.push({
      id: iconTheme.id,
      name: iconTheme.name,
      description: iconTheme.description || `${iconTheme.name} icon theme`,
      category: "icon-theme",
      isInstalled: true,
      isEnabled: true,
      isActive: selectedIconThemeId === iconTheme.id,
      version: "1.0.0",
      icon: getCatalogIconUrl(iconTheme.id, iconTheme.name, "icon-theme"),
      selectionId: iconTheme.id,
      appearanceOptions: [
        {
          id: iconTheme.id,
          name: iconTheme.name,
          description: iconTheme.description,
        },
      ],
    });
  });

  for (const skill of aiSkills) {
    const preview = skill.content.trim().replace(/\s+/g, " ").slice(0, 160);
    const marketplaceSkill =
      skill.source === "marketplace"
        ? marketplaceSkills.find(
            (candidate) => candidate.id === skill.sourceId || candidate.id === skill.id,
          )
        : undefined;

    allExtensions.push({
      id: skill.id,
      name: skill.title,
      description: skill.description || preview || "Reusable AI chat instructions",
      category: "skill",
      isInstalled: true,
      isEnabled: true,
      version: skill.version || (skill.source === "marketplace" ? undefined : "Local"),
      publisher: skill.author || (skill.source === "marketplace" ? "Marketplace" : "You"),
      isMarketplace: skill.source === "marketplace",
      icon: getCatalogIconUrl(skill.title, skill.author, "codex"),
      skill,
      marketplaceSkill,
      contributionSummary: ["skill"],
    });
  }

  for (const skill of marketplaceSkills) {
    if (isMarketplaceSkillInstalled(aiSkills, skill.id)) {
      continue;
    }

    allExtensions.push({
      id: skill.id,
      name: skill.title,
      description: skill.description,
      category: "skill",
      isInstalled: false,
      isEnabled: false,
      version: skill.version,
      publisher: skill.author,
      isMarketplace: true,
      icon: getCatalogIconUrl(skill.title, skill.author, "codex"),
      marketplaceSkill: skill,
      contributionSummary: ["skill"],
    });
  }

  const agentIds = new Set(
    allExtensions
      .filter((extension) => extension.category === "agent")
      .map((extension) => extension.agentId ?? extension.id.replace(/^agent:/, "")),
  );
  for (const agent of agents) {
    if (agentIds.has(agent.id)) {
      continue;
    }

    allExtensions.push({
      id: `agent:${agent.id}`,
      name: agent.name,
      description: agent.description ?? "ACP-compatible coding agent",
      category: "agent",
      isInstalled: agent.installed,
      isEnabled: agent.installed,
      extensions: [agent.binaryName],
      publisher: "Marketplace",
      isMarketplace: true,
      agentId: agent.id,
      icon: resolveManifestIcon(agent.icon ?? undefined, agent.id, agent.name, agent.binaryName),
      canInstall: agent.canInstall,
      contributionSummary: [`agent:${agent.id}`, agent.binaryName],
    });
  }

  return allExtensions;
}
