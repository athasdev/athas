export interface AIChatSkill {
  id: string;
  title: string;
  description?: string;
  content: string;
  author?: string;
  source?: "local" | "marketplace";
  sourceId?: string;
  version?: string;
  tags?: string[];
  localOverride?: boolean;
  upstreamTitle?: string;
  upstreamDescription?: string;
  upstreamContent?: string;
  upstreamUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceSkill {
  id: string;
  title: string;
  description: string;
  content: string;
  author?: string;
  version?: string;
  tags: string[];
  sourceUrl?: string;
  updatedAt?: string;
}
