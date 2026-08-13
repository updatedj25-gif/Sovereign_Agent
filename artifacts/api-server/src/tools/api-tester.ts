import { Router, Request, Response } from "express";

export const apiTesterRouter = Router();

export interface ApiTestRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

export interface ApiTestResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: any;
  responseTimeMs: number;
  success: boolean;
}

/**
 * Utility function to execute API endpoint test requests
 */
export async function executeApiTest(params: ApiTestRequest): Promise<ApiTestResponse> {
  const method = params.method || "GET";
  const timeoutMs = params.timeoutMs || 10000;
  const startTime = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(params.headers || {}),
      },
      signal: controller.signal,
    };

    if (params.body && method !== "GET") {
      fetchOptions.body = typeof params.body === "string" ? params.body : JSON.stringify(params.body);
    }

    const res = await fetch(params.url, fetchOptions);
    clearTimeout(timer);

    const responseTimeMs = Date.now() - startTime;
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((val, key) => {
      resHeaders[key] = val;
    });

    let bodyData: any;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      bodyData = await res.json();
    } else {
      bodyData = await res.text();
    }

    return {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
      body: bodyData,
      responseTimeMs,
      success: res.ok,
    };
  } catch (err: any) {
    clearTimeout(timer);
    return {
      status: 0,
      statusText: err.name === "AbortError" ? "Request Timeout" : "Network Error",
      headers: {},
      body: { error: err.message },
      responseTimeMs: Date.now() - startTime,
      success: false,
    };
  }
}

/**
 * POST /api/tools/test-endpoint
 * Express route endpoint for testing external or internal HTTP endpoints
 */
apiTesterRouter.post("/test-endpoint", async (req: Request, res: Response) => {
  try {
    const testReq: ApiTestRequest = req.body;
    if (!testReq.url) {
      return res.status(400).json({ error: "Missing required field: 'url'" });
    }

    const result = await executeApiTest(testReq);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});