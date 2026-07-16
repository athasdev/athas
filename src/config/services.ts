import { SERVICE_DEFAULTS } from "@/config/service-defaults";
import { getApiBase } from "@/utils/api-base";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getServiceUrls() {
  const apiBaseUrl = getApiBase();
  const websiteBaseUrl = trimTrailingSlash(
    import.meta.env.VITE_WEBSITE_URL?.trim() || SERVICE_DEFAULTS.websiteBaseUrl,
  );
  const extensionsCdnBaseUrl = trimTrailingSlash(
    import.meta.env.VITE_EXTENSIONS_CDN_BASE_URL?.trim() ||
      import.meta.env.VITE_PARSER_CDN_URL?.trim() ||
      SERVICE_DEFAULTS.extensionsCdnBaseUrl,
  );
  const updateBaseUrl = import.meta.env.VITE_UPDATE_BASE_URL?.trim();

  return {
    ...SERVICE_DEFAULTS,
    websiteBaseUrl,
    apiBaseUrl,
    docsUrl: `${websiteBaseUrl}/docs`,
    telemetryDocsUrl: `${websiteBaseUrl}/docs/telemetry`,
    pricingUrl: `${websiteBaseUrl}/pricing`,
    dashboardUrl: `${websiteBaseUrl}/dashboard`,
    dashboardBillingUrl: `${websiteBaseUrl}/dashboard/settings/billing`,
    dashboardIntegrationsUrl: `${websiteBaseUrl}/dashboard/settings/integrations`,
    dashboardCollaborationUrl: `${websiteBaseUrl}/dashboard/collaboration`,
    extensionsCdnBaseUrl,
    skillsRegistryUrl:
      import.meta.env.VITE_SKILLS_REGISTRY_URL?.trim() || `${websiteBaseUrl}/skills/index.json`,
    stableUpdateUrl: updateBaseUrl
      ? `${trimTrailingSlash(updateBaseUrl)}/api/update/stable`
      : SERVICE_DEFAULTS.stableUpdateUrl,
    previewUpdateUrl: updateBaseUrl
      ? `${trimTrailingSlash(updateBaseUrl)}/api/update/preview`
      : SERVICE_DEFAULTS.previewUpdateUrl,
  };
}
