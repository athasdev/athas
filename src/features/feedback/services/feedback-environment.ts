import { getVersion } from "@tauri-apps/api/app";
import { platform, version as osVersion } from "@tauri-apps/plugin-os";
import { aggregateFrictionSignals, type FeedbackEnvironment } from "../lib/feedback-draft";
import { getTelemetryLogEntries } from "@/features/telemetry/services/telemetry";

export async function getFeedbackEnvironment(): Promise<FeedbackEnvironment> {
  const [appVersionResult, entriesResult] = await Promise.allSettled([
    getVersion(),
    getTelemetryLogEntries(),
  ]);
  let os: string;
  try {
    os = `${platform()} ${osVersion()}`;
  } catch {
    os = navigator.userAgent;
  }

  return {
    appVersion: appVersionResult.status === "fulfilled" ? appVersionResult.value : "unknown",
    os,
    frictionSignals: aggregateFrictionSignals(
      entriesResult.status === "fulfilled" ? entriesResult.value : [],
    ),
  };
}
