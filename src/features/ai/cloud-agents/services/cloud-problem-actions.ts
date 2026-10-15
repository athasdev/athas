import { getServiceUrls } from "@/config/services";
import { openExternalUrl } from "@/utils/external-url";
import type { CloudProblemAction } from "./cloud-environment";

/** Opens the page that fixes a cloud problem: GitHub integrations, billing or plans. */
export function openCloudProblemPage(action: CloudProblemAction) {
  const services = getServiceUrls();
  const url =
    action === "connect-github"
      ? services.dashboardIntegrationsUrl
      : action === "open-billing"
        ? services.dashboardBillingUrl
        : action === "see-plans"
          ? services.pricingUrl
          : null;
  if (url)
    void openExternalUrl(url).catch((error: unknown) =>
      console.error("Failed to open the cloud agents page:", error),
    );
}
