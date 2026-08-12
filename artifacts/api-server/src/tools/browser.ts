import { z } from "zod";
import { globalToolRegistry } from "../agent/tools/registry";

export interface BrowserInspectionOptions {
  url: string;
  viewportWidth?: number;
  viewportHeight?: number;
  waitForSelector?: string;
  timeoutMs?: number;
  captureConsoleLogs?: boolean;
}

export interface BrowserInspectionResult {
  success: boolean;
  url: string;
  screenshotBase64?: string;
  title?: string;
  consoleLogs: Array<{ type: string; text: string }>;
  domSummary?: string;
  error?: string;
  durationMs: number;
}

/**
 * Headless Browser Inspection Runner using Playwright (or Puppeteer fallback).
 */
export async function inspectPageWithBrowser(
  options: BrowserInspectionOptions
): Promise<BrowserInspectionResult> {
  const {
    url,
    viewportWidth = 1280,
    viewportHeight = 720,
    waitForSelector,
    timeoutMs = 15000,
    captureConsoleLogs = true,
  } = options;

  const startTime = Date.now();
  const consoleLogs: Array<{ type: string; text: string }> = [];

  try {
    // Dynamic import playwright to avoid hard startup crashes if playwright binary is not installed
    const { chromium } = await import("playwright");

    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage({
      viewport: { width: viewportWidth, height: viewportHeight },
    });

    if (captureConsoleLogs) {
      page.on("console", (msg) => {
        consoleLogs.push({ type: msg.type(), text: msg.text() });
      });
      page.on("pageerror", (err) => {
        consoleLogs.push({ type: "error", text: err.message });
      });
    }

    // Navigate to preview URL
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: timeoutMs });
    }

    const title = await page.title();

    // Capture screenshot as base64 PNG
    const screenshotBuffer = await page.screenshot({ fullPage: false, type: "png" });
    const screenshotBase64 = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;

    // Extract minimal DOM text summary for LLM analysis
    const domSummary = await page.evaluate(() => {
      const body = document.body;
      return body ? body.innerText.slice(0, 1500) : "No body text";
    });

    await browser.close();

    return {
      success: true,
      url,
      title,
      screenshotBase64,
      consoleLogs,
      domSummary,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      success: false,
      url,
      consoleLogs,
      error: `Browser inspection failed: ${err.message || String(err)}`,
      durationMs: Date.now() - startTime,
    };
  }
}

// ==========================================
// Register Browser Tool in Agent Registry
// ==========================================

globalToolRegistry.registerTool({
  name: "capture_page_screenshot",
  description:
    "Launch a headless browser session to navigate a web app preview URL, capture a visual screenshot, and collect browser console logs.",
  parameters: z.object({
    url: z.string().url().describe("Target preview URL to visually inspect (e.g. 'http://localhost:5173')."),
    waitForSelector: z.string().optional().describe("Optional CSS selector to wait for before taking screenshot."),
    viewportWidth: z.number().optional().describe("Viewport width in pixels (default: 1280)."),
    viewportHeight: z.number().optional().describe("Viewport height in pixels (default: 720)."),
  }),
  execute: async (args, context) => {
    const result = await inspectPageWithBrowser({
      url: args.url,
      waitForSelector: args.waitForSelector,
      viewportWidth: args.viewportWidth,
      viewportHeight: args.viewportHeight,
    });

    if (!result.success) {
      return {
        success: false,
        output: `Visual verification failed for ${args.url}: ${result.error}`,
        error: "BROWSER_INSPECTION_FAILED",
      };
    }

    // Emit event so UI can render VisualPreviewModal
    context.emitEvent?.({
      type: "visual_verification_captured",
      url: result.url,
      title: result.title,
      screenshotBase64: result.screenshotBase64,
      consoleLogsCount: result.consoleLogs.length,
      domSummarySnippet: result.domSummary?.slice(0, 200),
    });

    const errorLogs = result.consoleLogs.filter((l) => l.type === "error");

    return {
      success: true,
      output: `Captured visual screenshot of '${result.url}' (${result.title || "Untitled"}).\nBrowser Console Errors: ${
        errorLogs.length
      }\nDOM Text Snippet: "${result.domSummary?.slice(0, 150)}..."`,
      data: {
        url: result.url,
        screenshotBase64: result.screenshotBase64,
        consoleLogs: result.consoleLogs,
        domSummary: result.domSummary,
      },
    };
  },
});