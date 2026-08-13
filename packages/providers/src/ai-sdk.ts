import { createHash } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { z } from "zod";

export type AiSdkStructuredGenerationInput<T> = {
  modelKey: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  name: string;
  description?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export type AiSdkStructuredGenerationResult<T> = {
  output: T;
  responseId?: string;
  responseModelId: string;
  responseHash: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

function hashResponse(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/**
 * Structured generation adapter for OpenAI-compatible gateways.
 *
 * This is intentionally separate from ProviderPort.chat(): the caller supplies
 * the domain schema, so the AI SDK can ask the model for a typed object and
 * validate it before the result crosses into the domain layer. It is also
 * injectable with a fetch implementation, which keeps contract tests free of
 * network calls and prevents retrying a billed request behind the caller's back.
 */
export class AiSdkStructuredGenerator {
  readonly providerKey: string;
  private readonly provider: ReturnType<typeof createOpenAICompatible>;

  constructor(private readonly options: {
    apiKey: string;
    baseUrl?: string;
    providerKey?: string;
    fetcher?: typeof fetch;
  }) {
    this.providerKey = options.providerKey ?? "apimart";
    this.provider = createOpenAICompatible({
      name: this.providerKey,
      apiKey: options.apiKey,
      baseURL: options.baseUrl ?? "https://api.apimart.ai/v1",
      fetch: options.fetcher,
      supportsStructuredOutputs: true,
      includeUsage: true,
      // APIMart defaults to text/event-stream when `stream` is omitted.
      // AI SDK's generateText path expects one JSON response, so make the
      // non-streaming contract explicit instead of trying to parse SSE here.
      transformRequestBody: (body) => ({ ...body, stream: false }),
    });
  }

  async generate<T>(input: AiSdkStructuredGenerationInput<T>): Promise<AiSdkStructuredGenerationResult<T>> {
    const result = await generateText({
      model: this.provider(input.modelKey),
      system: input.system,
      prompt: input.prompt,
      output: Output.object({ schema: input.schema, name: input.name, description: input.description }),
      maxOutputTokens: input.maxOutputTokens ?? 2_500,
      temperature: input.temperature ?? 0.2,
      maxRetries: 0,
      timeout: input.timeoutMs ?? 90_000,
    });
    const output = input.schema.parse(result.output);
    const responseModelId = result.response.modelId || input.modelKey;
    const responseHash = hashResponse({ responseId: result.response.id, responseModelId, output });
    return {
      output,
      responseId: result.response.id || undefined,
      responseModelId,
      responseHash,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  }
}
