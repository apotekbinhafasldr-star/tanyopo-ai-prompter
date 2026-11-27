/**
 * Antarmuka struktural minimal untuk memanggil fungsi Paket 3 lewat rpc(). Fungsi baru belum ada pada tipe Database hasil generate,
 * jadi klien Supabase di-cast ke bentuk ini di satu tempat saja.
 */
export interface ConsentRpcResult {
  data: unknown;
  error: { message?: string } | null;
}

export interface ConsentRpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<ConsentRpcResult>;
}

export function asConsentRpc(client: unknown): ConsentRpcClient {
  return client as ConsentRpcClient;
}
