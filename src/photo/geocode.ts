export interface Place {
  /** What the person typed. */
  query: string;
  /** Geocoder's full name of the match, when there is one. */
  displayName?: string;
  latitude?: number;
  longitude?: number;
}

const USER_AGENT =
  "telegram-scanner-bot (+https://github.com/isachivka/telegram-scanner-bot)";

/**
 * Forward-geocode a free-text place with a Nominatim-compatible API. Returns
 * undefined when nothing matches. Nominatim's usage policy asks for an
 * identifying User-Agent and at most one request per second, which a person
 * typing answers never exceeds.
 */
export async function geocode(
  baseUrl: string,
  query: string,
  opts: { language?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Place | undefined> {
  const f = opts.fetchImpl ?? fetch;
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  if (opts.language) url.searchParams.set("accept-language", opts.language);
  const res = await f(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new Error(`geocoder answered HTTP ${res.status}`);
  const hits = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  const hit = hits[0];
  if (!hit) return undefined;
  const latitude = Number(hit.lat);
  const longitude = Number(hit.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { query, displayName: hit.display_name, latitude, longitude };
}
