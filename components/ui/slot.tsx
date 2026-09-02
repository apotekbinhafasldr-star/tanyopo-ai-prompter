import * as React from "react";

/**
 * Minimal `asChild` helper, avoids pulling in @radix-ui/react-slot for a
 * single use case. Merges className/style/props/ref onto the single child.
 */
export const Slot = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ children, ...props }, ref) => {
    // `children` may arrive as an array (e.g. Button renders an optional
    // loading spinner alongside `children`), so pick the single valid
    // element out of it rather than requiring a bare element.
    const candidates = React.Children.toArray(children).filter(React.isValidElement);
    if (candidates.length !== 1) {
      return null;
    }

    const child = candidates[0] as React.ReactElement<Record<string, unknown>>;

    return React.cloneElement(child, {
      ...props,
      ...child.props,
      className: [props.className, child.props.className]
        .filter(Boolean)
        .join(" "),
      ref,
    });
  },
);
Slot.displayName = "Slot";
