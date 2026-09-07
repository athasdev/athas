import type { SVGProps } from "react";

/**
 * Brand marks are not UI icons.
 *
 * They carry a third party's fixed artwork, so they keep their own viewBox and
 * fill, opt out of the `src/ui/icons` stroke system, and must not be redrawn to
 * match the icon grid. Product concepts belong in `src/ui/icons` instead.
 */
export type BrandMarkProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

export function GithubMark({ size = "1em", ...props }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M7.499 0.25A7.25 7.25 0 0 0 5.208 14.38c.363.066.495-.158.495-.35 0-.172-.006-.628-.01-1.233-2.016.438-2.442-.972-2.442-.972-.33-.838-.805-1.061-.805-1.061-.658-.449.05-.44.05-.44.728.051 1.11.747 1.11.747.647 1.108 1.697.788 2.11.602.066-.468.254-.788.46-.969-1.61-.183-3.302-.806-3.302-3.583 0-.792.283-1.438.747-1.945-.075-.184-.324-.92.07-1.919 0 0 .609-.195 1.994.743a6.97 6.97 0 0 1 1.815-.244A6.97 6.97 0 0 1 9.315 4c1.384-.938 1.992-.743 1.992-.743.396.998.147 1.735.073 1.919.464.507.745 1.153.745 1.945 0 2.785-1.696 3.398-3.31 3.577.26.224.491.666.491 1.343 0 .969-.009 1.751-.009 1.989 0 .194.131.42.499.349A7.25 7.25 0 0 0 7.499.25Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}
