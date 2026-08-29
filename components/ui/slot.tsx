import * as React from "react";

/**
 * Minimal `asChild` helper, avoids pulling in @radix-ui/react-slot for a
 * single use case. Merges className/style/props/ref onto the single child.
 */
export const Slot = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ children, ...props }, ref) => {
    if (!React.isValidElement(children)) {
      return null;
    }

    const child = children as React.ReactElement<Record<string, unknown>>;

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
