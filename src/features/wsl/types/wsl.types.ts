export interface WslDistribution {
  name: string;
  state?: string | null;
  version?: number | null;
  is_default: boolean;
}
