import { logger } from "@/features/editor/utils/logger";

/**
 * A language an installed integration contributes, looked up by id, file extension, alias or file
 * name to detect the language of a file. Highlighting comes from the editor's own languages.
 */
export interface LanguageProvider {
  id: string;
  extensions: string[];
  aliases?: string[];
  filenames?: string[];
}

interface LanguageProviderRegistration {
  provider: LanguageProvider;
  lookupKeys: string[];
}

class LanguageProviderRegistry {
  private providers = new Map<string, LanguageProvider>();
  private registrations = new Map<string, LanguageProviderRegistration>();

  register(extensionId: string, provider: LanguageProvider): void {
    this.unregister(extensionId);

    const lookupKeys = Array.from(
      new Set([
        provider.id,
        ...provider.extensions.flatMap((extension) => [
          extension,
          extension.startsWith(".") ? extension.slice(1) : extension,
        ]),
        ...(provider.aliases ?? []),
        ...(provider.filenames ?? []),
      ]),
    );

    for (const lookupKey of lookupKeys) {
      this.providers.set(lookupKey, provider);
    }
    this.registrations.set(extensionId, { provider, lookupKeys });
  }

  unregister(extensionId: string): boolean {
    const registration = this.registrations.get(extensionId);
    if (!registration) return false;

    for (const lookupKey of registration.lookupKeys) {
      if (this.providers.get(lookupKey) === registration.provider) {
        this.providers.delete(lookupKey);
      }
    }
    this.registrations.delete(extensionId);
    return true;
  }

  has(extensionId: string): boolean {
    return this.registrations.has(extensionId);
  }

  get(languageIdOrExtension: string): LanguageProvider | undefined {
    return this.providers.get(languageIdOrExtension);
  }

  async ensure(languageIdOrExtension: string): Promise<LanguageProvider | undefined> {
    const existing = this.get(languageIdOrExtension);
    if (existing) return existing;

    try {
      const { waitForExtensionRuntimeInitialization } =
        await import("@/extensions/runtime/extension-runtime");
      await waitForExtensionRuntimeInitialization();
    } catch (error) {
      logger.debug("LanguageProviderRegistry", "Failed to wait for integration runtime:", error);
    }

    return this.get(languageIdOrExtension);
  }
}

export const languageProviderRegistry = new LanguageProviderRegistry();
