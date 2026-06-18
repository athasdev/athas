export interface V0DesignSystemProfile {
  id: string;
  name: string;
  registryUrl: string;
  description?: string;
  tailwindConfigPath?: string;
  globalsCssPath?: string;
  componentsJsonPath?: string;
}
