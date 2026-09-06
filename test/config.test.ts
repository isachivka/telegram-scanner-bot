import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";
import { baseEnv } from "./helpers.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(baseEnv());
    expect(c.telegram?.language).toBe("en");
    expect(c.telegram?.allowedUserIds).toEqual(new Set([1001]));
    expect(c.scanner.device).toBe("airscan:e0:Scanner");
    expect(c.scanner.modes).toEqual(["Color", "Gray"]);
    expect(c.scanner.defaultMode).toBe("Color");
    expect(c.scanner.dpiOptions).toEqual([200, 300, 600]);
    expect(c.scanner.defaultDpi).toBe(300);
    expect(c.scanner.format).toBe("jpeg");
    expect(c.printer?.queue).toBe("FakeQueue");
    expect(c.printer?.copiesOptions).toEqual([1, 2, 3, 5, 10]);
    expect(c.printer?.maxFileBytes).toBe(20 * 1024 * 1024);
    expect(c.mcp.http).toBeUndefined();
  });

  it("leaves the device undefined when neither SCANNER_URL nor SCANNER_DEVICE is set", () => {
    const c = loadConfig(baseEnv({ SCANNER_URL: undefined }));
    expect(c.scanner.device).toBeUndefined();
  });

  it("prefers an explicit SCANNER_DEVICE over the generated one", () => {
    const c = loadConfig(baseEnv({ SCANNER_DEVICE: "test:0" }));
    expect(c.scanner.device).toBe("test:0");
  });

  it("disables printing without PRINTER_QUEUE", () => {
    expect(loadConfig(baseEnv({ PRINTER_QUEUE: undefined })).printer).toBeUndefined();
    expect(loadConfig(baseEnv({ PRINTER_QUEUE: "  " })).printer).toBeUndefined();
  });

  it("allows an MCP-only deployment without a Telegram token", () => {
    const c = loadConfig(
      baseEnv({
        TELEGRAM_BOT_TOKEN: undefined,
        MCP_HTTP_PORT: "8765",
        MCP_AUTH_TOKEN: "0123456789abcdef",
      }),
    );
    expect(c.telegram).toBeUndefined();
    expect(c.mcp.http).toEqual({
      host: "0.0.0.0",
      port: 8765,
      path: "/mcp",
      authToken: "0123456789abcdef",
      publicUrl: undefined,
      linkTtlMs: 7 * 24 * 3600 * 1000,
      uploadMaxBytes: 50 * 1024 * 1024,
    });
  });

  it("refuses an MCP HTTP endpoint without a token", () => {
    expect(() => loadConfig(baseEnv({ MCP_HTTP_PORT: "8765" }))).toThrow(
      /MCP_AUTH_TOKEN is required/,
    );
    expect(() =>
      loadConfig(baseEnv({ MCP_HTTP_PORT: "8765", MCP_AUTH_TOKEN: "short" })),
    ).toThrow(/at least 16/);
  });

  it("parses custom modes, dpi and copies lists", () => {
    const c = loadConfig(
      baseEnv({
        SCAN_MODES: "Lineart, Gray",
        SCAN_DEFAULT_MODE: "Gray",
        SCAN_DPI_OPTIONS: "150,300",
        SCAN_DEFAULT_DPI: "150",
        PRINT_COPIES_OPTIONS: "1,2",
        SCANIMAGE_EXTRA_ARGS: "--brightness=10  -x 210",
      }),
    );
    expect(c.scanner.modes).toEqual(["Lineart", "Gray"]);
    expect(c.scanner.defaultMode).toBe("Gray");
    expect(c.scanner.dpiOptions).toEqual([150, 300]);
    expect(c.scanner.defaultDpi).toBe(150);
    expect(c.printer?.copiesOptions).toEqual([1, 2]);
    expect(c.scanner.extraArgs).toEqual(["--brightness=10", "-x", "210"]);
  });

  it("falls back to the first dpi when 300 is not offered", () => {
    expect(loadConfig(baseEnv({ SCAN_DPI_OPTIONS: "150,600" })).scanner.defaultDpi).toBe(
      150,
    );
  });

  it("rejects defaults outside their option lists", () => {
    expect(() => loadConfig(baseEnv({ SCAN_DEFAULT_MODE: "Sepia" }))).toThrow(
      ConfigError,
    );
    expect(() => loadConfig(baseEnv({ SCAN_DEFAULT_DPI: "1200" }))).toThrow(
      /SCAN_DEFAULT_DPI/,
    );
  });

  it("reports every invalid variable at once", () => {
    let message = "";
    try {
      loadConfig(
        baseEnv({ ALLOWED_USER_IDS: "1,abc", SCAN_DPI_OPTIONS: "0", BOT_LANGUAGE: "fr" }),
      );
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/ALLOWED_USER_IDS/);
    expect(message).toMatch(/SCAN_DPI_OPTIONS/);
    expect(message).toMatch(/BOT_LANGUAGE/);
  });
});
