import type { AvailableExtension } from "@/extensions/registry/extension-store-types";
import type { BundledExtension, ExtensionManifest } from "@/extensions/types/extension-manifest";

export interface ExtensionRuntimeCandidate {
  manifest: ExtensionManifest;
  path?: string;
}

export function buildExtensionRuntimeCandidates(
  availableExtensions: Iterable<AvailableExtension>,
  registeredExtensions: Iterable<BundledExtension>,
): ExtensionRuntimeCandidate[] {
  const candidates = new Map<string, ExtensionRuntimeCandidate>();

  for (const extension of registeredExtensions) {
    if (!extension.isEnabled || extension.state === "not-installed") {
      continue;
    }

    candidates.set(extension.manifest.id, {
      manifest: extension.manifest,
      path: extension.path || undefined,
    });
  }

  for (const extension of availableExtensions) {
    if (!extension.isInstalled || !extension.isEnabled) {
      continue;
    }

    const registeredExtension = candidates.get(extension.manifest.id);
    candidates.set(extension.manifest.id, {
      manifest: extension.manifest,
      path: registeredExtension?.path,
    });
  }

  return Array.from(candidates.values());
}
