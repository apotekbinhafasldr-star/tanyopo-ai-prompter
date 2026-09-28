"use client";

import type { ComponentPropsWithoutRef } from "react";

/**
 * P1-1 — Destructive-Action UX Protection.
 *
 * Minimal client-side wrapper around a native `<form action={...}>` server
 * action submission. Intercepts submit with a native `window.confirm()`
 * before the request leaves the browser at all — Cancel calls
 * `event.preventDefault()`, which stops the request completely (the
 * server action is never invoked, no network request is made). Confirm
 * lets the event proceed exactly as a plain `<form action={...}>` would,
 * submitting the same FormData to the same, unmodified server action.
 *
 * Deliberately does not touch the server action itself: no change to its
 * body, authorization, tenant scoping, status guard, storage logic, or
 * database logic. This component only decides whether the existing form
 * submission happens at all.
 */
export function ConfirmForm({
  message,
  children,
  ...props
}: { message: string } & ComponentPropsWithoutRef<"form">) {
  return (
    <form
      {...props}
      onSubmit={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </form>
  );
}
