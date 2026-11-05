import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSameAnswer, isUnknownAnswer, parseApproxDate } from "../src/photo/dates.js";
import { detectPhoto, renderPhoto } from "../src/photo/crop.js";
import { esclScanPlaten, parseCapabilities } from "../src/core/escl.js";
import { ImmichClient } from "../src/photo/immich.js";
import { geocode } from "../src/photo/geocode.js";
import { scanPhotoEscl } from "../src/photo/scan.js";
import { nullLogger } from "../src/util/logger.js";
import { loadConfig } from "../src/config.js";
import { baseEnv } from "./helpers.js";

const NOW = new Date("2026-11-05T10:00:00Z");

describe("parseApproxDate", () => {
  const cases: Array<[string, string, string]> = [
    ["12.05.1987", "1987-05-12", "day"],
    ["12/05/87", "1987-05-12", "day"],
    ["1987-05-12", "1987-05-12", "day"],
    ["05.1987", "1987-05-01", "month"],
    ["май 1987", "1987-05-01", "month"],
    ["Мая 1987 года", "1987-05-01", "month"],
    ["12 мая 1987", "1987-05-12", "day"],
    ["лето 87", "1987-07-01", "season"],
    ["зимой 1990", "1990-01-01", "season"],
    ["осень 2001", "2001-10-01", "season"],
    ["summer 1985", "1985-07-01", "season"],
    ["1987", "1987-01-01", "year"],
    ["87", "1987-01-01", "year"],
    ["примерно 1987 год", "1987-01-01", "year"],
    ["~1990", "1990-01-01", "year"],
    ["1987 г.", "1987-01-01", "year"],
    ["80-е", "1985-01-01", "decade"],
    ["80е", "1985-01-01", "decade"],
    ["1980-е годы", "1985-01-01", "decade"],
    ["в 80-х", "1985-01-01", "decade"],
    ["конец 70-х", "1978-01-01", "decade"],
    ["в конце 70-х", "1978-01-01", "decade"],
    ["начало 90-х", "1992-01-01", "decade"],
    ["середина 60-х", "1965-01-01", "decade"],
    ["2000-е", "2005-01-01", "decade"],
    ["1990s", "1995-01-01", "decade"],
    ["late 70s", "1978-01-01", "decade"],
  ];
  for (const [input, date, precision] of cases) {
    it(`"${input}" → ${date}`, () => {
      expect(parseApproxDate(input, NOW)).toEqual({
        date,
        precision,
        label: input.trim(),
      });
    });
  }

  it.each(["", "вчера", "31.02.1990", "13.1987", "3000", "85-е", "фото с моря"])(
    'rejects "%s"',
    (input) => {
      expect(parseApproxDate(input, NOW)).toBeUndefined();
    },
  );

  it("recognises unknown and same answers", () => {
    for (const s of ["-", "—", "не знаю", "Не знаю.", "?", "skip"]) {
      expect(isUnknownAnswer(s)).toBe(true);
    }
    expect(isUnknownAnswer("1987")).toBe(false);
    for (const s of ["=", "так же", "то же", "same"]) expect(isSameAnswer(s)).toBe(true);
    expect(isSameAnswer("Сочи")).toBe(false);
  });
});

describe("photo detection", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "photo-test-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  /** A white "platen" 2550×3500 with a photo-like block and some dust. */
  async function scan(
    name: string,
    rect?: { left: number; top: number; width: number; height: number },
  ) {
    const file = path.join(dir, name);
    const composites: sharp.OverlayOptions[] = [
      // dust speck and a shadow along the right edge, like a real lid
      {
        input: {
          create: {
            width: 6,
            height: 6,
            channels: 3,
            background: { r: 40, g: 40, b: 40 },
          },
        },
        left: 2000,
        top: 300,
      },
      {
        input: {
          create: {
            width: 20,
            height: 3500,
            channels: 3,
            background: { r: 200, g: 200, b: 200 },
          },
        },
        left: 2530,
        top: 0,
      },
    ];
    if (rect) {
      // a photo with a bright sky band in the middle, which must not split it
      const photo = await sharp({
        create: {
          width: rect.width,
          height: rect.height,
          channels: 3,
          background: { r: 120, g: 90, b: 60 },
        },
      })
        .composite([
          {
            input: {
              create: {
                width: rect.width - 40,
                height: Math.round(rect.height / 3),
                channels: 3,
                background: { r: 238, g: 242, b: 250 },
              },
            },
            left: 20,
            top: Math.round(rect.height / 3),
          },
        ])
        .png()
        .toBuffer();
      composites.push({ input: photo, left: rect.left, top: rect.top });
    }
    await sharp({
      create: {
        width: 2550,
        height: 3500,
        channels: 3,
        background: { r: 252, g: 252, b: 250 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 92 })
      .toFile(file);
    return file;
  }

  const close = (a: number, b: number) => Math.abs(a - b) <= 8;

  it("finds a photo in the middle of the glass", async () => {
    const file = await scan("mid.jpg", {
      left: 600,
      top: 900,
      width: 1200,
      height: 1800,
    });
    const box = await detectPhoto(file);
    expect(box).toBeDefined();
    expect(close(box!.left, 600) && close(box!.top, 900)).toBe(true);
    expect(close(box!.width, 1200) && close(box!.height, 1800)).toBe(true);
  });

  it("reclaims the edge band when the photo sits in the corner", async () => {
    const file = await scan("corner.jpg", { left: 0, top: 0, width: 1800, height: 1200 });
    const box = await detectPhoto(file);
    expect(box).toMatchObject({ left: 0, top: 0 });
    expect(close(box!.width, 1800) && close(box!.height, 1200)).toBe(true);
  });

  it("reports an empty glass", async () => {
    expect(await detectPhoto(await scan("empty.jpg"))).toBeUndefined();
  });

  it("renders the crop rotated, with EXIF date", async () => {
    const file = await scan("r.jpg", { left: 600, top: 900, width: 1200, height: 1800 });
    const out = path.join(dir, "out.jpg");
    await renderPhoto(file, out, {
      box: { left: 600, top: 900, width: 1200, height: 1800 },
      rotation: 90,
      exifDate: "1987:05:12 12:00:00",
    });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1800, 1200]);
    expect(meta.exif?.toString("latin1")).toContain("1987:05:12 12:00:00");
  });
});

describe("eSCL photo scan", () => {
  it("posts a full-platen job at the requested dpi and saves the document", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "escl-test-"));
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let busy = 1;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      if (url.endsWith("/ScannerCapabilities")) {
        return new Response(
          "<pwg:Version>2.63</pwg:Version><scan:Platen><scan:MaxWidth>2550</scan:MaxWidth><scan:MaxHeight>3507</scan:MaxHeight></scan:Platen>",
        );
      }
      if (url.endsWith("/ScanJobs")) {
        return new Response(null, {
          status: 201,
          headers: { location: "http://192.0.2.10/eSCL/ScanJobs/7" },
        });
      }
      if (url.endsWith("/ScanJobs/7/NextDocument")) {
        if (busy-- > 0) return new Response(null, { status: 503 });
        return new Response(Buffer.from("JPEGDATA"));
      }
      return new Response(null, { status: 404 });
    };
    const out = path.join(dir, "scan.jpg");
    await esclScanPlaten("http://192.0.2.10/eSCL", out, {
      dpi: 600,
      timeoutMs: 10_000,
      fetchImpl,
    });
    expect(await readFile(out, "utf8")).toBe("JPEGDATA");
    const job = calls.find((c) => c.method === "POST")!;
    expect(job.body).toContain("<scan:XResolution>600</scan:XResolution>");
    expect(job.body).toContain("<pwg:Width>2550</pwg:Width>");
    expect(job.body).toContain("<pwg:Height>3507</pwg:Height>");
    expect(job.body).toContain("<pwg:Version>2.63</pwg:Version>");
    // 503 while warming up, the page, then the one that closes the job.
    expect(calls.filter((c) => c.url.endsWith("NextDocument"))).toHaveLength(3);
    await rm(dir, { recursive: true, force: true });
  });

  it("waits for Idle and retries a job the scanner cancelled (410)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "escl-test-"));
    const states = ["Processing", "Idle", "Idle"];
    let jobs = 0;
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      seen.push(`${init?.method ?? "GET"} ${url.replace("http://192.0.2.10/eSCL", "")}`);
      if (url.endsWith("/ScannerStatus")) {
        return new Response(`<pwg:State>${states.shift() ?? "Idle"}</pwg:State>`);
      }
      if (url.endsWith("/ScanJobs")) {
        jobs++;
        return new Response(null, {
          status: 201,
          headers: { location: `/eSCL/ScanJobs/${jobs}` },
        });
      }
      if (url.endsWith("/ScanJobs/1/NextDocument"))
        return new Response(null, { status: 410 });
      if (url.endsWith("/ScanJobs/2/NextDocument")) {
        return seen.filter((s) => s.endsWith("/ScanJobs/2/NextDocument")).length === 1
          ? new Response(Buffer.from("JPEG2"))
          : new Response(null, { status: 404 });
      }
      return new Response(null, { status: 404 });
    };
    const out = path.join(dir, "scan.jpg");
    await esclScanPlaten("http://192.0.2.10/eSCL", out, {
      dpi: 600,
      timeoutMs: 20_000,
      fetchImpl,
    });
    expect(await readFile(out, "utf8")).toBe("JPEG2");
    expect(seen.filter((s) => s !== "GET /ScannerCapabilities")).toEqual([
      "GET /ScannerStatus",
      "GET /ScannerStatus",
      "POST /ScanJobs",
      "GET /ScanJobs/1/NextDocument",
      "GET /ScannerStatus",
      "POST /ScanJobs",
      "GET /ScanJobs/2/NextDocument",
      "GET /ScanJobs/2/NextDocument",
    ]);
    await rm(dir, { recursive: true, force: true });
  });

  it("falls back to A4 when capabilities have no platen", () => {
    expect(parseCapabilities("<x/>")).toEqual({
      version: "2.0",
      width: 2550,
      height: 3507,
    });
  });
});

describe("two-pass photo scan", () => {
  /** Stub scanner: 300 dpi platen with a photo at (600,900) 1200×1800; any region at 600 dpi. */
  async function stubScanner(failHires: boolean) {
    const platen = await sharp({
      create: {
        width: 2550,
        height: 3507,
        channels: 3,
        background: { r: 252, g: 252, b: 250 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 1200,
              height: 1800,
              channels: 3,
              background: { r: 120, g: 90, b: 60 },
            },
          },
          left: 600,
          top: 900,
        },
      ])
      .jpeg()
      .toBuffer();
    const jobs: string[] = [];
    let current = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/ScanJobs") && init?.method === "POST") {
        current = String(init.body);
        jobs.push(current);
        return new Response(null, {
          status: 201,
          headers: { location: `/eSCL/ScanJobs/${jobs.length}` },
        });
      }
      const m = url.match(/ScanJobs\/(\d+)\/NextDocument$/);
      if (m) {
        const xml = jobs[Number(m[1]) - 1]!;
        if (seenDoc.has(m[1]!)) return new Response(null, { status: 404 });
        seenDoc.add(m[1]!);
        const dpi = Number(xml.match(/XResolution>(\d+)/)![1]);
        if (dpi === 300) return new Response(platen);
        if (failHires) return new Response(null, { status: 410 });
        const w = Number(xml.match(/<pwg:Width>(\d+)/)![1]);
        const h = Number(xml.match(/<pwg:Height>(\d+)/)![1]);
        const img = await sharp({
          create: {
            width: w * 2,
            height: h * 2,
            channels: 3,
            background: { r: 120, g: 90, b: 60 },
          },
        })
          .jpeg()
          .toBuffer();
        return new Response(img);
      }
      return new Response(null, { status: 404 });
    };
    const seenDoc = new Set<string>();
    return { fetchImpl, jobs };
  }

  it("finds the photo at 300 dpi and rescans only its region at 600", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "twopass-"));
    const { fetchImpl, jobs } = await stubScanner(false);
    const r = await scanPhotoEscl("http://192.0.2.10/eSCL", dir, 600, {
      timeoutMs: 20_000,
      log: nullLogger,
      fetchImpl,
    });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toContain("<scan:XResolution>300</scan:XResolution>");
    expect(jobs[1]).toContain("<scan:XResolution>600</scan:XResolution>");
    const region = (tag: string) =>
      Number(jobs[1]!.match(new RegExp(`<pwg:${tag}>(\\d+)`))![1]);
    expect(Math.abs(region("XOffset") - (600 - 24))).toBeLessThanOrEqual(3);
    expect(Math.abs(region("YOffset") - (900 - 24))).toBeLessThanOrEqual(3);
    expect(Math.abs(region("Width") - (1200 + 48))).toBeLessThanOrEqual(6);
    expect(r).toMatchObject({ dpi: 600, reduced: false });
    expect(r.file).toMatch(/photo-hires\.jpg$/);
    expect(Math.abs(r.box!.left - 48)).toBeLessThanOrEqual(6);
    expect(Math.abs(r.box!.width - 2400)).toBeLessThanOrEqual(12);
    expect(Math.abs(r.box!.height - 3600)).toBeLessThanOrEqual(12);
    await rm(dir, { recursive: true, force: true });
  });

  it("falls back to the 300 dpi crop when the scanner cancels the 600 dpi pass", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "twopass-"));
    const { fetchImpl, jobs } = await stubScanner(true);
    const r = await scanPhotoEscl("http://192.0.2.10/eSCL", dir, 600, {
      timeoutMs: 20_000,
      log: nullLogger,
      fetchImpl,
    });
    expect(jobs).toHaveLength(3); // preview + two 600 dpi attempts
    expect(r).toMatchObject({ dpi: 300, reduced: true });
    expect(r.file).toMatch(/platen\.jpg$/);
    expect(Math.abs(r.box!.left - 600)).toBeLessThanOrEqual(4);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("Immich client", () => {
  it("uploads, sets metadata, and creates a shared album once", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "immich-test-"));
    const file = path.join(dir, "p.jpg");
    await writeFile(file, "JPEG");
    const calls: Array<{ method: string; url: string; body?: unknown; key?: string }> =
      [];
    const albums: Array<{ id: string; albumName: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input).replace("http://immich.test/api", "");
      const method = init?.method ?? "GET";
      const key = new Headers(init?.headers).get("x-api-key") ?? undefined;
      let body: unknown;
      if (init?.body instanceof FormData) {
        body = Object.fromEntries(
          [...init.body.entries()].map(([k, v]) => [
            k,
            typeof v === "string" ? v : "<file>",
          ]),
        );
      } else if (typeof init?.body === "string") body = JSON.parse(init.body);
      calls.push({ method, url, body, key });
      const json = (v: unknown, status = 200) =>
        new Response(JSON.stringify(v), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (method === "POST" && url === "/assets")
        return json({ id: "a1", status: "created" }, 201);
      if (method === "PUT" && url === "/assets/a1") return json({ id: "a1" });
      if (method === "GET" && url.startsWith("/albums?")) return json(albums);
      if (method === "POST" && url === "/albums") {
        albums.push({ id: "al1", albumName: "Scans" });
        return json({ id: "al1" }, 201);
      }
      if (method === "PUT" && url === "/albums/al1/assets") return json([]);
      return json({ message: "nope" }, 400);
    };
    const immich = new ImmichClient("http://immich.test", "secret", fetchImpl);
    const id = await immich.upload(file, "scan.jpg", "1987-05-12T12:00:00.000Z");
    await immich.update(id, {
      dateTimeOriginal: "1987-05-12T12:00:00.000Z",
      latitude: 43.58,
      longitude: 39.72,
      description: "x",
    });
    expect(await immich.ensureAlbum("Scans", ["u-dasha"])).toBe("al1");
    expect(await immich.ensureAlbum("Scans", ["u-dasha"])).toBe("al1");
    await immich.addToAlbum("al1", [id]);

    expect(calls.every((c) => c.key === "secret")).toBe(true);
    expect(calls[0]!.body).toMatchObject({
      assetData: "<file>",
      fileCreatedAt: "1987-05-12T12:00:00.000Z",
      filename: "scan.jpg",
    });
    expect(calls[1]!.body).toEqual({
      dateTimeOriginal: "1987-05-12T12:00:00.000Z",
      latitude: 43.58,
      longitude: 39.72,
      description: "x",
    });
    const created = calls.filter((c) => c.method === "POST" && c.url === "/albums");
    expect(created).toHaveLength(1);
    expect(created[0]!.body).toMatchObject({
      albumName: "Scans",
      albumUsers: [{ userId: "u-dasha", role: "editor" }],
    });
    await expect(immich.update("zzz", { description: "y" })).rejects.toThrow(
      /HTTP 400 nope/,
    );
    await rm(dir, { recursive: true, force: true });
  });
});

describe("geocode", () => {
  it("returns the first hit and sends a User-Agent", async () => {
    let ua: string | null = null;
    let requested = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      requested = String(input);
      ua = new Headers(init?.headers).get("user-agent");
      return new Response(
        JSON.stringify([{ lat: "43.58", lon: "39.72", display_name: "Сочи, Россия" }]),
      );
    };
    const hit = await geocode("https://geo.test", "Сочи", { language: "ru", fetchImpl });
    expect(hit).toEqual({
      query: "Сочи",
      displayName: "Сочи, Россия",
      latitude: 43.58,
      longitude: 39.72,
    });
    expect(requested).toContain("accept-language=ru");
    expect(ua).toMatch(/telegram-scanner-bot/);
    const none = await geocode("https://geo.test", "x", {
      fetchImpl: async () => new Response("[]"),
    });
    expect(none).toBeUndefined();
  });
});

describe("photo config", () => {
  it("is off without IMMICH_URL and on with a key", () => {
    expect(loadConfig(baseEnv()).photos).toBeUndefined();
    const c = loadConfig(
      baseEnv({
        IMMICH_URL: "http://immich.lan:2283/",
        IMMICH_API_KEYS: "1001:k1, 2002:k2",
        IMMICH_ALBUM_SHARE_WITH: "u1,u2",
      }),
    ).photos!;
    expect(c.immichUrl).toBe("http://immich.lan:2283");
    expect(c.publicUrl).toBe("http://immich.lan:2283");
    expect(c.apiKeys.get(2002)).toBe("k2");
    expect(c.dpi).toBe(600);
    expect(c.esclUrl).toBe("http://192.0.2.10/eSCL");
    expect(c.albumShareWith).toEqual(["u1", "u2"]);
  });

  it("rejects a URL without keys and malformed key entries", () => {
    expect(() => loadConfig(baseEnv({ IMMICH_URL: "http://i" }))).toThrow(
      /neither IMMICH_API_KEY nor IMMICH_API_KEYS/,
    );
    expect(() =>
      loadConfig(baseEnv({ IMMICH_URL: "http://i", IMMICH_API_KEYS: "oops" })),
    ).toThrow(/IMMICH_API_KEYS entries/);
  });

  it("scans through SANE when asked", () => {
    const c = loadConfig(
      baseEnv({ IMMICH_URL: "http://i", IMMICH_API_KEY: "k", PHOTO_SCAN_VIA: "sane" }),
    ).photos!;
    expect(c.esclUrl).toBeUndefined();
  });
});
