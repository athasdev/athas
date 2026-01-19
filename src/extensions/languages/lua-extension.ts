import { BaseLanguageProvider } from "./language-provider";

export class LuaLanguageExtension extends BaseLanguageProvider {
  constructor() {
    super({
      id: "lua",
      displayName: "Lua",
      extensions: ["lua"],
      aliases: ["lua"],
      description: "Lua language support",
    });
  }
}

export const luaLanguage = new LuaLanguageExtension();
