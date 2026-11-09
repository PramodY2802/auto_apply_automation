import type { AIConfigScope, AIProviderKey, AITask } from '@autoapply/shared';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AICompletionRequest {
  model: string;
  system?: string;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
  /** When set, the provider is asked for JSON conforming to this JSON Schema. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  timeoutMs?: number;
  /** Test/dev only: scripted response consumed by the mock provider. */
  mockResponse?: string;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AICompletionResult {
  text: string;
  usage: AIUsage;
  model: string;
  provider: AIProviderKey;
  latencyMs: number;
  finishReason?: string;
}

export interface AIProviderInterface {
  readonly key: AIProviderKey;
  complete(req: AICompletionRequest): Promise<AICompletionResult>;
  healthCheck(model: string): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

export type AIErrorCode =
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'BAD_RESPONSE'
  | 'LIMIT_EXCEEDED'
  | 'POLICY';

export class AIProviderError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly provider?: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** A provider configuration as resolved for a request (API key already decrypted, never logged). */
export interface ResolvedAIConfig {
  configId: string | null;
  scope: AIConfigScope;
  enterpriseId: string | null;
  userId: string | null;
  providerKey: AIProviderKey;
  apiKey: string | null;
  baseUrl?: string | null;
  defaultModel: string;
  taskModels: Partial<Record<AITask, string>>;
  allowFallback: boolean;
  fallbackProviderKeys: AIProviderKey[];
  monthlyTokenLimit: number | null;
  enabled: boolean;
}

export interface AIRequestContext {
  userId: string | null;
  enterpriseId: string | null;
  task: AITask;
}

export interface AIUsageEntry {
  userId: string | null;
  enterpriseId: string | null;
  configId: string | null;
  scope: AIConfigScope;
  provider: string;
  model: string;
  task: AITask;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'ok' | 'error';
  errorCode?: string;
  fallbackFrom?: string;
}

/** Storage-facing port the router uses to load configuration and record usage. */
export interface AIConfigSource {
  /** Configs available to this user, in precedence order (USER → ENTERPRISE → PLATFORM), already filtered by policy. */
  resolveConfigs(ctx: AIRequestContext): Promise<ResolvedAIConfig[]>;
  /** Tokens consumed this calendar month through a given config. */
  monthlyTokensUsed(configId: string): Promise<number>;
  recordUsage(entry: AIUsageEntry): Promise<string | null>;
}
