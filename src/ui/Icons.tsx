import type { SVGProps } from 'react';

/** Inline stroke icons. Decorative by default: the button that holds one carries the label. */
function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowLeft = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const Close = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const Search = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Icon>
);

/**
 * The rookie trap: a circle the way a pen makes one, which does not quite
 * close where it began. Drawn around the thing it marks (see `.ring` in the
 * stylesheet), never on its own.
 */
export const Ring = () => (
  <svg className="ring" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" aria-hidden="true" focusable="false">
    <path pathLength={100} d="M28.9 7.7A15.5 15 0 1 0 34.6 14.9C33.8 9.4 29.6 3.6 23 1.6" />
  </svg>
);
