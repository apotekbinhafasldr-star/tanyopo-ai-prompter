/**
 * Minimal chainable mock of the slice of the supabase-js query builder
 * lib/umkmpro/handoff.ts uses. Each `.from(table)` call pops the next
 * canned response queued for that table (in call order), so a test can
 * script "first call returns no existing row, second call returns the
 * inserted row" the same way the real sequence of awaits happens.
 */
export function createMockAdmin(responses: Record<string, Array<{ data: unknown; error: unknown; count?: number }>>) {
  const queues = new Map(Object.entries(responses).map(([k, v]) => [k, [...v]]));

  function nextResponse(table: string) {
    const queue = queues.get(table);
    const response = queue?.shift();
    return response ?? { data: null, error: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function chain(table: string): any {
    const response = nextResponse(table);
    const builder = {
      select: () => builder,
      insert: () => builder,
      upsert: () => builder,
      update: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(response),
      single: () => Promise.resolve(response),
      then: (
        onFulfilled?: ((value: typeof response) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => Promise.resolve(response).then(onFulfilled ?? undefined, onRejected ?? undefined),
    };
    return builder;
  }

  return {
    from: (table: string) => chain(table),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
