"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectAction } from "@/features/connections/actions";
import type { ConnectorPlatform } from "@/types/database";

export function DisconnectButton({ platform }: { platform: ConnectorPlatform }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="ghost"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await disconnectAction(platform);
            if (result.error) setError(result.error);
          });
        }}
      >
        Putuskan
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
