export type { AIChatSkill } from "@/features/settings/types/ai-settings.types";

export interface MarketplaceSkill {
  id: string;
  title: string;
  description: string;
  content?: string;
  author?: string;
  license?: string;
  version?: string;
  tags: string[];
  detailUrl?: string;
  sourceUrl?: string;
  updatedAt?: string;
}

export interface ResolvedMarketplaceSkill extends MarketplaceSkill {
  content: string;
}
