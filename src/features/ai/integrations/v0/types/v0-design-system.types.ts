export interface V0DesignSystemProfile {
  readonly id: string;
  readonly name: string;
  readonly registryUrl: string;
  readonly description?: string;
  readonly homepage?: string;
  readonly tailwindConfigPath?: string;
  readonly globalsCssPath?: string;
  readonly componentsJsonPath?: string;
}
