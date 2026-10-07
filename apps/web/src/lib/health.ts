export interface HealthResponse {
  status: string;
  service: string;
}

/** Calls the API health endpoint. VITE_API_URL is empty in dev (Vite proxy) and behind Caddy. */
export async function fetchHealth(
  baseUrl: string = import.meta.env.VITE_API_URL ?? '',
  fetchFn: typeof fetch = fetch,
): Promise<HealthResponse> {
  const res = await fetchFn(`${baseUrl}/api/v1/health`);
  if (!res.ok) throw new Error(`Health check failed with status ${res.status}`);
  return (await res.json()) as HealthResponse;
}
