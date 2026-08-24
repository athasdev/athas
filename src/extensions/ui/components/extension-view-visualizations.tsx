import { Progress, ProgressLabel, ProgressValue } from "@/ui/progress";
import { Sparkline } from "@/ui/sparkline";
import type { ExtensionViewNode, ExtensionViewTone } from "../types/extension-view";

type SparklineNode = Extract<ExtensionViewNode, { type: "sparkline" }>;
type BarChartNode = Extract<ExtensionViewNode, { type: "barChart" }>;

const chartTone = (tone: ExtensionViewTone | undefined) => tone ?? "default";

export function ExtensionViewSparkline({ node }: { node: SparklineNode }) {
  const minimum = Math.min(...node.values);
  const maximum = Math.max(...node.values);
  const latest = node.values[node.values.length - 1];
  const valueSummary = `${node.values.length} points, minimum ${minimum}, maximum ${maximum}, latest ${latest}`;
  return (
    <div data-slot="extension-view-sparkline" className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center justify-between gap-2 ui-text-sm">
        <span className="truncate font-medium text-foreground">{node.label}</span>
        {node.detail ? (
          <span className="shrink-0 tabular-nums text-subtle-foreground">{node.detail}</span>
        ) : null}
      </div>
      <Sparkline
        values={node.values}
        label={`${node.label}: ${valueSummary}`}
        tone={chartTone(node.tone)}
      />
    </div>
  );
}

export function ExtensionViewBarChart({ node }: { node: BarChartNode }) {
  const maximum = Math.max(...node.items.map((item) => item.value), 0);
  return (
    <div
      data-slot="extension-view-bar-chart"
      role="group"
      aria-label={node.label ?? "Bar chart"}
      className="flex min-w-0 flex-col gap-2"
    >
      {node.label ? (
        <div className="font-medium text-foreground ui-text-sm">{node.label}</div>
      ) : null}
      {node.items.map((item, index) => {
        const percentage = maximum === 0 ? 0 : (item.value / maximum) * 100;
        const valueText = item.detail ?? String(item.value);
        return (
          <Progress
            key={`${item.label}-${index}`}
            value={percentage}
            tone={chartTone(item.tone)}
            aria-label={`${item.label}: ${valueText}`}
            aria-valuetext={valueText}
          >
            <ProgressLabel>{item.label}</ProgressLabel>
            <ProgressValue>{() => valueText}</ProgressValue>
          </Progress>
        );
      })}
    </div>
  );
}
