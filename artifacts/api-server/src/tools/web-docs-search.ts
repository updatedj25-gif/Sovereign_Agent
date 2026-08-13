import { z } from "zod";
import { globalToolRegistry, ToolExecutionResult, ToolExecutionContext } from "../agent/registry";

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Execute web search via DuckDuckGo HTML endpoint with fallback extraction
 */
export async function performWebSearch(
  query: string,
  maxResults: number = 5
): Promise<SearchResultItem[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Web search returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResultItem[] = [];

  // Parse DuckDuckGo HTML search result snippets using regex patterns
  const resultRegex = /<a class="result__a" href="([^"]+)">(.*?)<\/a>[\s\S]*?<a class="result__snippet[^>]*">(.*?)<\/a>/g;

  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    let rawUrl = match[1];
    // Decode DuckDuckGo redirect wrapper URL if present
    if (rawUrl.includes("uddg=")) {
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        rawUrl = decodeURIComponent(uddgMatch[1]);
      }
    }

    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();

    if (rawUrl && title) {
      results.push({ title, url: rawUrl, snippet });
    }
  }

  return results;
}

/**
 * Fetch and extract clean text content from a web documentation URL
 */
export async function fetchDocPage(
  url: string,
  maxLength: number = 4000
): Promise<{ title: string; content: string; url: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Sovereign-Doc-Fetcher/1.0",
      Accept: "text/html,application/xhtml+xml,text/plain",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch documentation page (HTTP ${response.status}): ${url}`);
  }

  const html = await response.text();

  // Extract page <title>
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "Documentation Page";

  // Strip scripts, styles, and HTML tags to extract clean text
  let cleanText = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\n\s*\n/g, "\n")
    .trim();

  if (cleanText.length > maxLength) {
    cleanText = cleanText.slice(0, maxLength) + "\n\n... [Documentation Text Truncated]";
  }

  return { title, content: cleanText, url };
}

// ==========================================
// Register Web & Docs Search Tools
// ==========================================

globalToolRegistry.registerTool({
  name: "web_search",
  description:
    "Search the web for up-to-date framework documentation, error solutions, or library API references.",
  parameters: z.object({
    query: z.string().describe("Search query (e.g. 'React 19 useActionState migration guide' or 'Express 5 route wildcard error')."),
    maxResults: z.number().optional().describe("Maximum search results to return (default: 5)."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      context.emitEvent?.({
        type: "web_search_started",
        query: args.query,
      });

      const results = await performWebSearch(args.query, args.maxResults || 5);

      if (results.length === 0) {
        return {
          success: true,
          output: `No search results found for '${args.query}'.`,
          data: { resultsCount: 0 },
        };
      }

      const formatted = results
        .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
        .join("\n\n");

      return {
        success: true,
        output: `Web Search Results for '${args.query}':\n\n${formatted}`,
        data: { resultsCount: results.length, results },
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Web Search Error: ${err.message}`,
        error: "WEB_SEARCH_FAILED",
      };
    }
  },
});

globalToolRegistry.registerTool({
  name: "fetch_doc_pages",
  description:
    "Fetch and extract readable text content from an online documentation URL.",
  parameters: z.object({
    url: z.string().url().describe("Documentation URL to fetch."),
    maxLength: z.number().optional().describe("Maximum text characters to extract (default: 4000)."),
  }),
  execute: async (args, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    try {
      context.emitEvent?.({
        type: "fetch_doc_started",
        url: args.url,
      });

      const page = await fetchDocPage(args.url, args.maxLength || 4000);

      return {
        success: true,
        output: `DOCUMENTATION: ${page.title}\nURL: ${page.url}\n\n${page.content}`,
        data: page,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Fetch Documentation Error: ${err.message}`,
        error: "FETCH_DOC_FAILED",
      };
    }
  },
});