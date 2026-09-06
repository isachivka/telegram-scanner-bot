import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imagesToPdf } from "../src/core/pdf.js";
import { parseDeviceList } from "../src/core/scanner.js";
import { ExecError, exec } from "../src/util/exec.js";
import { createSandbox, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(async () => {
  sb = await createSandbox();
});
afterEach(() => sb.cleanup());

describe("exec", () => {
  it("captures stderr in the error", async () => {
    process.env.FAKE_SCAN_FAIL = "1";
    await expect(exec("scanimage", ["--output-file=/dev/null"])).rejects.toThrow(
      /scanimage exited with code 1: scanimage: sane_start: Device busy/,
    );
  });

  it("kills a process that exceeds the timeout", async () => {
    process.env.FAKE_SCAN_SLEEP = "5";
    const err = await exec("scanimage", ["--output-file=/dev/null"], {
      timeoutMs: 200,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ExecError);
    expect(err.message).toMatch(/killed by SIGKILL/);
    expect(err.message).toMatch(/timed out after 200 ms/);
  });

  it("reports missing binaries readably", async () => {
    await expect(exec("definitely-not-a-binary", [])).rejects.toThrow(/ENOENT/);
  });
});

describe("Scanner", () => {
  it("scans a page with the configured device, mode, dpi and format", async () => {
    const out = path.join(sb.dir, "page.jpg");
    await sb.services.scanner.scanPage(out, { mode: "Gray", dpi: 200 });
    expect((await stat(out)).size).toBeGreaterThan(0);
    expect(await sb.calls()).toEqual([
      `scanimage --device-name=airscan:e0:Scanner --mode=Gray --resolution=200 --format=jpeg --output-file=${out}`,
    ]);
  });

  it("passes --source and extra args through", async () => {
    await sb.cleanup();
    sb = await createSandbox({
      SCAN_SOURCE: "Flatbed",
      SCANIMAGE_EXTRA_ARGS: "-x 210 -y 297",
    });
    const out = path.join(sb.dir, "page.jpg");
    await sb.services.scanner.scanPage(out, { mode: "Color", dpi: 300 });
    expect((await sb.calls())[0]).toBe(
      `scanimage --device-name=airscan:e0:Scanner --mode=Color --resolution=300 --format=jpeg -x 210 -y 297 --source=Flatbed --output-file=${out}`,
    );
  });

  it("serialises concurrent scans and reports busy", async () => {
    process.env.FAKE_SCAN_SLEEP = "0.3";
    const { scanner } = sb.services;
    const a = scanner.scanPage(path.join(sb.dir, "a.jpg"), { mode: "Color", dpi: 300 });
    expect(scanner.isBusy()).toBe(true);
    const b = scanner.scanPage(path.join(sb.dir, "b.jpg"), { mode: "Color", dpi: 300 });
    await Promise.all([a, b]);
    expect(scanner.isBusy()).toBe(false);
    expect((await sb.calls()).length).toBe(2);
  });

  it("scans the feeder in batch mode and tolerates SANE_STATUS_NO_DOCS", async () => {
    process.env.FAKE_ADF_PAGES = "3";
    process.env.FAKE_ADF_EXIT7 = "1";
    const { pages } = await sb.services.scanner.scanFeeder(sb.dir, 4, {
      mode: "Color",
      dpi: 300,
    });
    expect(pages.map((p) => path.basename(p))).toEqual([
      "page_004.jpg",
      "page_005.jpg",
      "page_006.jpg",
    ]);
    expect((await sb.calls())[0]).toBe(
      `scanimage --device-name=airscan:e0:Scanner --mode=Color --resolution=300 --format=jpeg --source=ADF --batch=${sb.dir}/page_%03d.jpg --batch-start=4`,
    );
  });

  it("returns no pages for an empty feeder", async () => {
    process.env.FAKE_ADF_PAGES = "0";
    process.env.FAKE_ADF_EXIT7 = "1";
    const { pages } = await sb.services.scanner.scanFeeder(sb.dir, 1, {
      mode: "Color",
      dpi: 300,
    });
    expect(pages).toEqual([]);
  });

  it("lists devices", async () => {
    const devices = await sb.services.scanner.listDevices();
    expect(devices).toEqual([
      { name: "airscan:e0:Fake MFP", description: "eSCL Fake MFP ip=192.0.2.10" },
      { name: "test:0", description: "Noname frontend-tester virtual device" },
    ]);
  });
});

describe("parseDeviceList", () => {
  it("ignores unrelated output", () => {
    expect(parseDeviceList("\nNo scanners were identified.\n")).toEqual([]);
    expect(parseDeviceList("device `a:b' is a X Y\njunk\n")).toEqual([
      { name: "a:b", description: "X Y" },
    ]);
  });
});

describe("imagesToPdf", () => {
  it("assembles pages in order", async () => {
    const { scanner } = sb.services;
    const p1 = path.join(sb.dir, "1.jpg");
    const p2 = path.join(sb.dir, "2.jpg");
    await scanner.scanPage(p1, { mode: "Color", dpi: 300 });
    await scanner.scanPage(p2, { mode: "Color", dpi: 300 });
    const out = await imagesToPdf([p1, p2], path.join(sb.dir, "out.pdf"));
    const pdf = await readFile(out, "utf8");
    expect(pdf).toMatch(/^%PDF/);
    expect(pdf.indexOf("1.jpg")).toBeLessThan(pdf.indexOf("2.jpg"));
  });

  it("rejects an empty page list", async () => {
    await expect(imagesToPdf([], "/dev/null")).rejects.toThrow(/no pages/);
  });
});

describe("Printer", () => {
  it("prints with the queue and copies and parses the job id", async () => {
    const file = path.join(sb.dir, "doc.pdf");
    await sb.services.scanner.scanPage(file, { mode: "Color", dpi: 300 });
    const job = await sb.services.printer!.print(file, { copies: 3 });
    expect(job.jobId).toBe("FakeQueue-42");
    expect((await sb.calls()).at(-1)).toBe(`lp -d FakeQueue -n 3 -- ${file}`);
  });

  it("surfaces lp errors", async () => {
    process.env.FAKE_LP_FAIL = "1";
    await expect(sb.services.printer!.print("/nope.pdf", { copies: 1 })).rejects.toThrow(
      /printer or class does not exist/,
    );
  });

  it("reports status", async () => {
    expect(await sb.services.printer!.status()).toMatch(/printer FakeQueue is idle/);
  });
});
