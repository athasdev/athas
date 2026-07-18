import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

export function V0Icon({ size, className, ...props }: IconProps) {
  const resolvedSize = size ?? 14;

  return (
    <svg
      aria-hidden="true"
      width={resolvedSize}
      height={Math.round(resolvedSize * 0.48)}
      viewBox="0 0 147 70"
      fill="currentColor"
      className={className}
      {...props}
    >
      <path d="M56 50.2031V14H70V60.1562C70 65.5928 65.5928 70 60.1562 70C57.5605 70 54.9982 68.9992 53.1562 67.1573L0 14H19.7969L56 50.2031Z" />
      <path d="M147 56H133V23.9531L100.953 56H133V70H96.6875C85.8144 70 77 61.1856 77 50.3125V14H91V46.1562L123.156 14H91V0H127.312C138.186 0 147 8.81439 147 19.6875V56Z" />
    </svg>
  );
}
