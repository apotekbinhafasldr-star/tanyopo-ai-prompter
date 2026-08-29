import * as React from "react";
import { cn } from "@/lib/utils/cn";

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => {
  return (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium text-foreground [&:has(+_[disabled])]:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
Label.displayName = "Label";
