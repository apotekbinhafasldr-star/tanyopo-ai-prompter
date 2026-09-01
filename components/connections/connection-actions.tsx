"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  disconnectProviderAction,
  verifyProviderConnectionAction,
  type ConnectionActionState,
} from "@/features/connections/actions";

const initialState: ConnectionActionState = { error: null };

export function DisconnectButton({ platform }: { platform: string }) {
  const [state, formAction, pending] = useActionState(disconnectProviderAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="platform" value={platform} />
      <Button type="submit" variant="outline" size="sm" loading={pending}>
        Putuskan
      </Button>
      {state.error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function VerifyButton({ platform }: { platform: string }) {
  const [state, formAction, pending] = useActionState(verifyProviderConnectionAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="platform" value={platform} />
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        Verifikasi Ulang
      </Button>
      {state.error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
