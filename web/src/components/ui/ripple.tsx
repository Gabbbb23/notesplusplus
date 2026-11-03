import "@material/web/ripple/ripple.js";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "md-ripple": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { disabled?: boolean };
    }
  }
}

/**
 * The M3 state layer and press ripple, from @material/web. Put it as the last child of an interactive
 * element that is `relative`; it follows the element's corners and takes its content colour
 * (index.css sets the M3 opacities).
 */
export function Ripple({ disabled }: { disabled?: boolean }) {
  return <md-ripple aria-hidden="true" disabled={disabled || undefined} />;
}
