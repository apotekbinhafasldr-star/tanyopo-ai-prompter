import * as React from "react";
import { cn } from "@/lib/utils/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-10 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-danger aria-invalid:ring-danger/30",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
