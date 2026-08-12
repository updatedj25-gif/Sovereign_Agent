import { z } from "zod";
import { globalToolRegistry, ToolExecutionResult, ToolExecutionContext } from "../agent/registry";

export interface BrowserActionStep {
  action: "navigate" | "click" | "type" | "wait_for_selector" | "screenshot";
  selector?: string;
  text?: string;
  url?: string;
  timeoutMs?: number;
}

export interface InteractiveBrowserOptions {
  url: string;
  actions?: BrowserActionStep[];
  viewportWidth?: number;
  viewportHeight?: number;
  timeoutMs?: number;
}

export interface InteractiveBrowserResult {
  success: boolean;
  url: string;
  title?: string;
  screenshotBase64?: string;
  consoleLogs: Array<{ type: string; text: string }>;
  domSummary?: string;
  executedActionsCount: number;
  error?: string;
  durationMs: number;
}

/**
 * Headless Playwright Browser Engine supporting multi-step UI interaction (click, type, wait, screenshot)
 */
export async function runInteractiveBrowserSession(
  options: InteractiveBrowserOptions
): Promise<InteractiveBrowserResult> {
  const {
    url,
    actions = [],
    viewportWidth = 1280,
    viewportHeight = 720,
    timeoutMs = 20000,
  } = options;

  const startTime = Date.now();
  const consoleLogs: Array<{ type: string; text: string }> = [];
  let executedCount = 0;

  try {
    // Dynamic import Playwright to handle environments gracefully
    const { chromium } = await import("playwright");

    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage({
      viewport: { width: viewportWidth, height: viewportHeight },
    });

    // Attach console log listeners
    page.on("console", (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
    page.on("pageerror", (err) => {
      consoleLogs.push({ type: "error", text: err.message });
    });

    // 1. Initial Page Navigation
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });

    // 2. Execute Sequence of UI Interaction Steps
    for (const step of actions) {
      const stepTimeout = step.timeoutMs || 5000;

      if (step.action === "navigate" && step.url) {
        await page.goto(step.url, { waitUntil: "networkidle", timeout: stepTimeout });
      } else if (step.action === "click" && step.selector) {
        await page.waitForSelector(step.selector, { timeout: stepTimeout });
        await page.click(step.selector);
      } else if (step.action === "type" && step.selector && step.text !== undefined) {
        await page.waitForSelector(step.selector, { timeout: stepTimeout });
        await page.fill(step.selector, step.text);
      } else if (step.action === "wait_for_selector" && step.selector) {
        await page.waitForSelector(step.selector, { timeout: stepTimeout });
      }

      executedCount++;
    }

    const title = await page.title();

    // 3. Capture Visual Screenshot Base64
    const screenshotBuffer = await page.screenshot({ fullPage: false, type: "png" });
    const screenshotBase64 = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;

    // 4. Extract Text Content Summary
    const domSummary = await page.evaluate(() => {
      return document.body ? document.body.innerText.slice(0, 1500) : "";
    });

    await browser.close();

    return {
      success: true,
      url: page.url() || url,
      title,
      screenshotBase64,
      consoleLogs,
      domSummary,
      executedActionsCount: executedCount,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      success: false,
      url,
      consoleLogs,
      executedActionsCount: executedCount,
      error: `Interactive browser session failed: ${err.message || String(err)}`,
      durationMs: Date.now() - startTime,
    };
  }
}

// ==========================================
// Register Interactive Browser Tools
// ==========================================

globalToolRegistry.registerTool({
  name: "capture_page_screenshot",
  description:
    "Launch a headless browser session to navigate a web app URL, capture a visual screenshot, and collect browser console error logs.",
  parameters: z.object({
    url: z.string().url().describe("Target preview URL to visually inspect (e.g. 'http://localhost:5173')."),
    waitForSelector: z.string().optional().describe("Optional CSS selector to wait for before taking screenshot."),
    viewportWidth: z.number().optional().describe("Viewport width in pixels (default: 1280)."),
    viewportHeight: z.number().optional().describe("Viewport height in pixels (default: 720)."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const actions: BrowserActionStep[] = [];
    if (args.waitForSelector) {
      actions.push({ action: "wait_for_selector", selector: args.waitForSelector });
    }

    const result = await runInteractiveBrowserSession({
      url: args.url,
      actions,
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
      }\nDOM Snippet: "${result.domSummary?.slice(0, 150)}..."`,
      data: result,
    };
  },
});

globalToolRegistry.registerTool({
  name: "interactive_browser_action",
  description:
    "Execute an interactive end-to-end UI testing flow (clicking elements, typing inputs, submitting forms) and capture updated screenshots.",
  parameters: z.object({
    url: z.string().url().describe("Starting page URL."),
    actions: z
      .array(
        z.object({
          action: z.enum(["navigate", "click", "type", "wait_for_selector", "screenshot"]),
          selector: z.string().optional().describe("CSS selector for target element."),
          text: z.string().optional().describe("Text input value for 'type' action."),
          url: z.string().optional().describe("Target URL for 'navigate' action."),
        })
      )
      .describe("Array of UI interaction steps to execute in sequence."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      context.emitEvent?.({
        type: "interactive_browser_started",
        url: args.url,
        actionsCount: args.actions.length,
      });

      const result = await runInteractiveBrowserSession({
        url: args.url,
        actions: args.actions as BrowserActionStep[],
      });

      if (!result.success) {
        return {
          success: false,
          output: `Interactive Browser Flow Failed at step ${result.executedActionsCount}: ${result.error}`,
          error: "INTERACTIVE_FLOW_FAILED",
        };
      }

      context.emitEvent?.({
        type: "visual_verification_captured",
        url: result.url,
        title: result.title,
        screenshotBase64: result.screenshotBase64,
        consoleLogsCount: result.consoleLogs.length,
      });

      return {
        success: true,
        output: `Executed ${result.executedActionsCount} UI action(s) on '${result.url}'.\nFinal Title: ${result.title}\nConsole Errors: ${
          result.consoleLogs.filter((l) => l.type === "error").length
        }`,
        data: result,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Interactive Browser Flow Execution Error: ${err.message}`,
        error: "INTERACTIVE_BROWSER_ERROR",
      };
    }
  },
});
