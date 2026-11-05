import { writeFile } from "node:fs/promises";

/**
 * Minimal eSCL (AirScan) client for one flatbed JPEG scan.
 *
 * Photo scans go straight to the scanner instead of through SANE: sane-airscan
 * only offers the resolutions the scanner advertises, and many MFPs advertise
 * 300 dpi while scanning the platen at their full optical resolution (600 dpi
 * on an HP Laser MFP 135w) when asked directly.
 */

export interface EsclScanOptions {
  dpi: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface PlatenSize {
  /** Version string the scanner reports; echoed back in ScanSettings. */
  version: string;
  /** Platen size in 1/300 inch. */
  width: number;
  height: number;
}

/** A4-ish fallback when the capabilities document has no platen size. */
const DEFAULT_PLATEN: PlatenSize = { version: "2.0", width: 2550, height: 3507 };

export function parseCapabilities(xml: string): PlatenSize {
  const version = xml.match(/<pwg:Version>([^<]+)<\/pwg:Version>/)?.[1]?.trim();
  const platen = xml.match(/<scan:Platen>([\s\S]*?)<\/scan:Platen>/)?.[1] ?? "";
  const num = (tag: string) => {
    const v = platen.match(new RegExp(`<scan:${tag}>(\\d+)</scan:${tag}>`))?.[1];
    return v ? Number(v) : undefined;
  };
  return {
    version: version ?? DEFAULT_PLATEN.version,
    width: num("MaxWidth") ?? DEFAULT_PLATEN.width,
    height: num("MaxHeight") ?? DEFAULT_PLATEN.height,
  };
}

export function scanSettingsXml(platen: PlatenSize, dpi: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>${platen.version}</pwg:Version>
  <scan:Intent>Photo</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:Height>${platen.height}</pwg:Height>
      <pwg:Width>${platen.width}</pwg:Width>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>Platen</pwg:InputSource>
  <scan:ColorMode>RGB24</scan:ColorMode>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <scan:XResolution>${dpi}</scan:XResolution>
  <scan:YResolution>${dpi}</scan:YResolution>
</scan:ScanSettings>
`;
}

export class EsclError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EsclError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Scan the whole platen in colour into a JPEG at `outPath`. */
export async function esclScanPlaten(
  baseUrl: string,
  outPath: string,
  opts: EsclScanOptions,
): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + opts.timeoutMs;
  const signal = () => AbortSignal.timeout(Math.max(1000, deadline - Date.now()));

  let platen = DEFAULT_PLATEN;
  const caps = await f(`${baseUrl}/ScannerCapabilities`, { signal: signal() }).catch(
    () => undefined,
  );
  if (caps?.ok) platen = parseCapabilities(await caps.text());

  const created = await f(`${baseUrl}/ScanJobs`, {
    method: "POST",
    headers: { "content-type": "text/xml" },
    body: scanSettingsXml(platen, opts.dpi),
    signal: signal(),
  });
  if (created.status === 503) throw new EsclError("scanner is busy (eSCL 503)");
  if (created.status !== 201) {
    throw new EsclError(`scanner refused the scan job (HTTP ${created.status})`);
  }
  const location = created.headers.get("location");
  if (!location) throw new EsclError("scanner returned no job location");
  const jobUrl = new URL(location, `${baseUrl}/`).toString().replace(/\/+$/, "");

  // The first NextDocument blocks until the page is scanned; some scanners
  // answer 503 while warming up instead.
  while (true) {
    const doc = await f(`${jobUrl}/NextDocument`, { signal: signal() });
    if (doc.status === 503 && Date.now() < deadline) {
      await sleep(1000);
      continue;
    }
    if (!doc.ok) throw new EsclError(`scan failed (HTTP ${doc.status})`);
    const body = Buffer.from(await doc.arrayBuffer());
    if (body.length === 0) throw new EsclError("scanner returned an empty image");
    await writeFile(outPath, body);
    return;
  }
}
