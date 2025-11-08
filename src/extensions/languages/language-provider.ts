import type {
  ExtensionContext,
  LanguageExtension,
  Token,
} from "@/features/editor/extensions/types";
import { getTokens } from "@/features/editor/lib/rust-api/tokens";

export interface LanguageConfig {
  id: string;
  displayName: string;
  extensions: string[];
  aliases?: string[];
  filenames?: string[];
  description?: string;
}

export abstract class BaseLanguageProvider implements LanguageExtension {
  readonly id: string;
  readonly displayName: string;
  readonly version: string = "1.0.0";
  readonly category: string = "language";
  readonly languageId: string;
  readonly extensions: string[];
  readonly aliases?: string[];
  readonly filenames?: string[];
  readonly description?: string;

  constructor(config: LanguageConfig) {
    this.languageId = config.id;
    this.id = `language.${config.id}`;
    this.displayName = config.displayName;
    this.extensions = config.extensions;
    this.aliases = config.aliases;
    this.filenames = config.filenames;
    this.description = config.description;
  }

  async activate(context: ExtensionContext): Promise<void> {
    context.registerLanguage({
      id: this.languageId,
      extensions: this.extensions,
      aliases: this.aliases,
    });
  }

  async deactivate(): Promise<void> {
    // Cleanup if needed
  }

  async getTokens(content: string): Promise<Token[]> {
    try {
      // Use the first extension as the file extension for tokenization
      const fileExtension = this.extensions[0];
      const tokens = await getTokens(content, fileExtension);
      return tokens;
    } catch (error) {
      console.error(`Failed to tokenize ${this.languageId}:`, error);
      return [];
    }
  }
}
