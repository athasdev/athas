import {
  ThinkingOrb as BaseThinkingOrb,
  type ThinkingOrbProps as BaseThinkingOrbProps,
} from "thinking-orbs";
import { type CSSProperties, useId } from "react";

type ThinkingOrbProps = Omit<BaseThinkingOrbProps, "theme"> & {
  color?: CSSProperties["color"];
};

function ThinkingOrb({ color = "var(--primary)", style, ...props }: ThinkingOrbProps) {
  const filterId = `thinking-orb-${useId().replace(/:/g, "")}`;

  return (
    <>
      <svg aria-hidden="true" className="absolute size-0" focusable="false">
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB">
            <feColorMatrix
              in="SourceGraphic"
              values="
                0 0 0 0 1
                0 0 0 0 1
                0 0 0 0 1
                0.2126 0.7152 0.0722 0 0
              "
              result="luminance"
            />
            <feComposite in="luminance" in2="SourceAlpha" operator="in" result="mask" />
            <feFlood floodColor={color} result="theme-color" />
            <feComposite in="theme-color" in2="mask" operator="in" />
          </filter>
        </defs>
      </svg>
      <BaseThinkingOrb theme="dark" style={{ ...style, filter: `url(#${filterId})` }} {...props} />
    </>
  );
}

export { ThinkingOrb };
export type { ThinkingOrbProps };
