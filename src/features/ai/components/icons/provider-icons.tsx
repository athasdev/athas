import type { SVGProps } from "react";
import { cn } from "@/utils/cn";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const defaultProps = (size = 14, className?: string): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  className,
});

export function OpenAIIcon({ size, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" {...defaultProps(size, className)} {...props}>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

export function AnthropicIcon({ size, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" {...defaultProps(size, className)} {...props}>
      <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.63-4.327H5.293l-1.63 4.327H0l6.57-16.96zm2.327 4.513L6.588 13.89h4.616L8.896 8.033z" />
    </svg>
  );
}

export function GeminiIcon({ size, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" {...defaultProps(size, className)} {...props}>
      <path d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z" />
    </svg>
  );
}

export function XAIIcon({ size, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" {...defaultProps(size, className)} {...props}>
      <path d="m1.075 20.864 7.17-10.377L1.5 1.136h4.287l4.615 6.584L15.015 1.136h4.288l-6.746 9.353L20.025 20.864h-4.288l-5.23-7.469-5.144 7.469z" />
      <path d="M18.222 1.136h3.278L14.016 10.489l-.947-1.35z" />
      <path d="M2.5 20.864h3.278l6.065-8.668-.947-1.35z" />
    </svg>
  );
}

export function DeepSeekIcon({ size, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" {...defaultProps(size, className)} {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
    </svg>
  );
}

export function OllamaIcon({ size, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" {...defaultProps(size, className)} {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12c0 3.04 1.36 5.76 3.5 7.6V22l2.5-1.5c1.24.46 2.58.72 4 .72 5.52 0 10-4.48 10-10S17.52 2 12 2zm-2.5 13.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm5 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
    </svg>
  );
}

export function OpenRouterIcon({ size, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" {...defaultProps(size, className)} {...props}>
      <path
        d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MoonshotIcon({ size, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" {...defaultProps(size, className)} {...props}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 0 1 0 16C8.27 20 4 15.52 4 12a8 8 0 0 1 8-8z" />
      <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c1.66 0 3-2.69 3-6s-1.34-6-3-6z" />
    </svg>
  );
}

export function QwenIcon({ size, className, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" {...defaultProps(size, className)} {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
      <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

export function CustomAPIIcon({ size, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      {...defaultProps(size, className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 17l6-6-6-6M12 19h8" />
    </svg>
  );
}

export function ProviderIcon({
  providerId,
  size = 14,
  className,
}: {
  providerId: string;
  size?: number;
  className?: string;
}) {
  const props = { size, className: cn("shrink-0", className) };

  switch (providerId) {
    case "openai":
    case "codex-cli":
      return <OpenAIIcon {...props} />;
    case "anthropic":
    case "claude-code":
      return <AnthropicIcon {...props} />;
    case "gemini":
    case "google":
    case "gemini-cli":
      return <GeminiIcon {...props} />;
    case "grok":
    case "xai":
    case "x-ai":
      return <XAIIcon {...props} />;
    case "deepseek":
      return <DeepSeekIcon {...props} />;
    case "ollama":
      return <OllamaIcon {...props} />;
    case "openrouter":
      return <OpenRouterIcon {...props} />;
    case "kimi-cli":
      return <MoonshotIcon {...props} />;
    case "qwen-code":
      return <QwenIcon {...props} />;
    case "opencode":
    case "custom":
      return <CustomAPIIcon {...props} />;
    default:
      return <CustomAPIIcon {...props} />;
  }
}
