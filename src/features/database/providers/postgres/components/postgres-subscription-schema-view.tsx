import { Radio } from "lucide-react";
import type { PostgresSubscriptionInfo } from "../../sqlite/sqlite-types";

interface PostgresSubscriptionSchemaViewProps {
  subscriptionInfo: PostgresSubscriptionInfo;
}

const formatBoolean = (value: boolean) => (value ? "true" : "false");

export default function PostgresSubscriptionSchemaView({
  subscriptionInfo,
}: PostgresSubscriptionSchemaViewProps) {
  const fields = [
    { label: "Owner", value: subscriptionInfo.owner },
    { label: "Enabled", value: formatBoolean(subscriptionInfo.enabled) },
    {
      label: "Publications",
      value: subscriptionInfo.publications.join(", ") || "-",
    },
    { label: "Slot", value: subscriptionInfo.slot_name || "-" },
    { label: "Sync Commit", value: subscriptionInfo.synchronous_commit || "-" },
    { label: "Streaming", value: subscriptionInfo.streaming || "-" },
    { label: "Two Phase", value: formatBoolean(subscriptionInfo.two_phase) },
    {
      label: "Two Phase State",
      value: subscriptionInfo.two_phase_state || "-",
    },
    { label: "Binary", value: formatBoolean(subscriptionInfo.binary) },
    {
      label: "Disable on Error",
      value: formatBoolean(subscriptionInfo.disable_on_error),
    },
    {
      label: "Password Required",
      value: formatBoolean(subscriptionInfo.password_required),
    },
    {
      label: "Run as Owner",
      value: formatBoolean(subscriptionInfo.run_as_owner),
    },
    { label: "Origin", value: subscriptionInfo.origin || "-" },
    { label: "Failover", value: formatBoolean(subscriptionInfo.failover) },
    { label: "Connection", value: subscriptionInfo.connection_string || "-" },
  ];

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex items-center gap-2 px-3 py-3">
        <Radio className="text-text-lighter" />
        <div>
          <div className="text-sm">{subscriptionInfo.name}</div>
          <div className="text-text-lighter text-xs">logical replication subscription</div>
        </div>
      </div>
      <div className="mx-3 mb-3 divide-y divide-border/60 rounded-xl bg-secondary-bg/40">
        {fields.map((field) => (
          <div key={field.label} className="px-3 py-2">
            <div className="text-text-lighter text-[11px] uppercase tracking-wide">
              {field.label}
            </div>
            <div className="mt-1 break-all text-sm">{field.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
