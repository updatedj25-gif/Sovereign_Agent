import { ReActMessage } from "./react-loop";

export type ModelTier = "fast" | "frontier" | "code_specialist";
export type ProviderType = "cloudflare" | "anthropic" | "openai" | "deepseek" | "gemini";

export interface ModelProviderConfig {
  tier: ModelTier;
  provider: ProviderType;
  modelId: string;
}

export interface RouterOptions {
  preferredTier?: ModelTier;
  preferredProvider?: ProviderType;
  fallbackEnabled?: boolean;
}

/**
 * Multi-Provider Model Router
 * Dynamically routes requests between fast models (e.g. Gemini Flash / Llama 3.3) and frontier reasoning models (e.g. Claude 3.5 Sonnet / DeepSeek R1).
 */
export class ModelRouter {
  private fastModel: ModelProviderConfig = {
    tier: "fast",
    provider: "cloudflare",
    modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  };

  private frontierModel: ModelProviderConfig = {
    tier: "frontier",
    provider: "anthropic",
    modelId: "claude-3-5-sonnet-20241022",
  };

  /**
   * Classify request prompt into fast vs frontier reasoning tier.
   */
  classifyTaskTier(prompt: string, historyLength: number): ModelTier {
    const complexKeywords = [
      "refactor",
      "architecture",
      "fix bug",
      "patch",
      "typecheck error",
      "self-heal",
      "vitest",
      "ast",
      "security",
    ];

    const isComplex =
      historyLength > 6 ||
      complexKeywords.some((keyword) => prompt.toLowerCase().includes(keyword));

    return isComplex ? "frontier" : "fast";
  }

  /**
   * Dispatch LLM query with automatic failover between primary and secondary providers.
   */
  async dispatch(
    messages: ReActMessage[],
    toolsJson: any[],
    options: RouterOptions = {}
  ): Promise<ReActMessage> {
    const lastUserPrompt = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const selectedTier = options.preferredTier || this.classifyTaskTier(lastUserPrompt, messages.length);

    const targetConfig = selectedTier === "frontier" ? this.frontierModel : this.fastModel;

    console.log(`[ModelRouter] Dispatching to ${targetConfig.provider} (${targetConfig.modelId}) [Tier: ${selectedTier}]`);

    try {
      return await this.executeProviderCall(targetConfig, messages, toolsJson);
    } catch (primaryErr: any) {
      console.warn(`[ModelRouter] Provider ${targetConfig.provider} failed: ${primaryErr.message}. Executing failover...`);

      if (options.fallbackEnabled !== false) {
        // Failover to Cloudflare AI fallback
        return await this.executeProviderCall(this.fastModel, messages, toolsJson);
      }

      throw primaryErr;
    }
  }

  private async executeProviderCall(
    config: ModelProviderConfig,
    messages: ReActMessage[],
    toolsJson: any[]
  ): Promise<ReActMessage> {
    switch (config.provider) {
      case "anthropic":
        return this.callAnthropicAPI(config.modelId, messages, toolsJson);
      case "deepseek":
        return this.callDeepSeekAPI(config.modelId, messages, toolsJson);
      case "cloudflare":
      default:
        return this.callCloudflareAI(config.modelId, messages, toolsJson);
    }
  }

  private async callCloudflareAI(modelId: string, messages: ReActMessage[], toolsJson: any[]): Promise<ReActMessage> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiKey = process.env.CLOUDFLARE_API_KEY;

    if (!accountId || !apiKey) {
      return { role: "assistant", content: `[ModelRouter] Cloudflare AI local response.` };
    }

    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${modelId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages, tools: toolsJson, temperature: 0.2 }),
    });

    if (!res.ok) throw new Error(`Cloudflare AI HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as any;

    return {
      role: "assistant",
      content: data.result?.response || (typeof data.result === "string" ? data.result : JSON.stringify(data.result)),
      tool_calls: data.result?.tool_calls,
    };
  }

  private async callAnthropicAPI(modelId: string, messages: ReActMessage[], toolsJson: any[]): Promise<ReActMessage> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return this.callCloudflareAI(this.fastModel.modelId, messages, toolsJson);

    const systemMsg = messages.find((m) => m.role === "system")?.content || "";
    const userMessages = messages.filter((m) => m.role !== "system");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 3000,
        system: systemMsg,
        messages: userMessages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
        tools: toolsJson,
      }),
    });

    if (!res.ok) throw new Error(`Anthropic API HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as any;

    return {
      role: "assistant",
      content: data.content?.[0]?.text || "Processing complete.",
    };
  }

  private async callDeepSeekAPI(modelId: string, messages: ReActMessage[], toolsJson: any[]): Promise<ReActMessage> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return this.callCloudflareAI(this.fastModel.modelId, messages, toolsJson);

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages, tools: toolsJson }),
    });

    if (!res.ok) throw new Error(`DeepSeek API HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as any;

    return {
      role: "assistant",
      content: data.choices?.[0]?.message?.content || "",
      tool_calls: data.choices?.[0]?.message?.tool_calls,
    };
  }
}

export const globalModelRouter = new ModelRouter();