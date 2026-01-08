/**
 * OpenAICompatibleAgent: OpenAI Compatible API observation extraction
 *
 * Alternative to SDKAgent that uses any OpenAI-compatible API endpoint.
 * Allows users to configure their own URL, API key, and model.
 *
 * Responsibility:
 * - Call user-configured OpenAI-compatible REST API for observation extraction
 * - Parse XML responses (same format as Claude/Gemini/OpenRouter)
 * - Sync to database and Chroma
 * - Support dynamic model selection via settings or model listing
 */

import { DatabaseManager } from './DatabaseManager.js';
import { SessionManager } from './SessionManager.js';
import { logger } from '../../utils/logger.js';
import { buildInitPrompt, buildObservationPrompt, buildSummaryPrompt, buildContinuationPrompt } from '../../sdk/prompts.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
import type { ActiveSession, ConversationMessage } from '../worker-types.js';
import { ModeManager } from '../domain/ModeManager.js';
import {
  processAgentResponse,
  shouldFallbackToClaude,
  isAbortError,
  type WorkerRef,
  type FallbackAgent
} from './agents/index.js';

// Context window management constants (defaults, overridable via settings)
const DEFAULT_MAX_CONTEXT_MESSAGES = 20;
const DEFAULT_MAX_ESTIMATED_TOKENS = 100000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

// Network configuration
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000; // 1 second base delay

// OpenAI-compatible message format
interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

export interface OpenAICompatibleModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

interface OpenAIModelsResponse {
  data?: OpenAICompatibleModel[];
  object?: string;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

export class OpenAICompatibleAgent {
  private dbManager: DatabaseManager;
  private sessionManager: SessionManager;
  private fallbackAgent: FallbackAgent | null = null;

  constructor(dbManager: DatabaseManager, sessionManager: SessionManager) {
    this.dbManager = dbManager;
    this.sessionManager = sessionManager;
  }

  /**
   * Set the fallback agent (Claude SDK) for when API fails
   */
  setFallbackAgent(agent: FallbackAgent): void {
    this.fallbackAgent = agent;
  }

  /**
   * Start OpenAI Compatible agent for a session
   */
  async startSession(session: ActiveSession, worker?: WorkerRef): Promise<void> {
    try {
      const config = this.getConfig();

      if (!config.baseUrl) {
        throw new Error('OpenAI Compatible API URL not configured. Set CLAUDE_MEM_OPENAI_COMPATIBLE_URL in settings.');
      }

      // Note: API key is optional for local servers (e.g., Ollama)

      const mode = ModeManager.getInstance().getActiveMode();

      // Build initial prompt
      const initPrompt = session.lastPromptNumber === 1
        ? buildInitPrompt(session.project, session.contentSessionId, session.userPrompt, mode)
        : buildContinuationPrompt(session.userPrompt, session.lastPromptNumber, session.contentSessionId, mode);

      // Add to conversation history and query API
      session.conversationHistory.push({ role: 'user', content: initPrompt });
      const initResponse = await this.queryAPI(session.conversationHistory, config);

      if (initResponse.content) {
        session.conversationHistory.push({ role: 'assistant', content: initResponse.content });

        const tokensUsed = initResponse.tokensUsed || 0;
        session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
        session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);

        await processAgentResponse(
          initResponse.content,
          session,
          this.dbManager,
          this.sessionManager,
          worker,
          tokensUsed,
          null,
          'OpenAI-Compatible'
        );
      } else {
        logger.warn('SDK', 'Empty OpenAI Compatible init response', {
          sessionId: session.sessionDbId,
          model: config.model
        });
      }

      // Process pending messages
      for await (const message of this.sessionManager.getMessageIterator(session.sessionDbId)) {
        const originalTimestamp = session.earliestPendingTimestamp;

        if (message.type === 'observation') {
          if (message.prompt_number !== undefined) {
            session.lastPromptNumber = message.prompt_number;
          }

          const obsPrompt = buildObservationPrompt({
            id: 0,
            tool_name: message.tool_name!,
            tool_input: JSON.stringify(message.tool_input),
            tool_output: JSON.stringify(message.tool_response),
            created_at_epoch: originalTimestamp ?? Date.now(),
            cwd: message.cwd
          });

          session.conversationHistory.push({ role: 'user', content: obsPrompt });
          const obsResponse = await this.queryAPI(session.conversationHistory, config);

          let tokensUsed = 0;
          if (obsResponse.content) {
            session.conversationHistory.push({ role: 'assistant', content: obsResponse.content });
            tokensUsed = obsResponse.tokensUsed || 0;
            session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
            session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
          }

          await processAgentResponse(
            obsResponse.content || '',
            session,
            this.dbManager,
            this.sessionManager,
            worker,
            tokensUsed,
            originalTimestamp,
            'OpenAI-Compatible'
          );

        } else if (message.type === 'summarize') {
          const summaryPrompt = buildSummaryPrompt({
            id: session.sessionDbId,
            memory_session_id: session.memorySessionId,
            project: session.project,
            user_prompt: session.userPrompt,
            last_assistant_message: message.last_assistant_message || ''
          }, mode);

          session.conversationHistory.push({ role: 'user', content: summaryPrompt });
          const summaryResponse = await this.queryAPI(session.conversationHistory, config);

          let tokensUsed = 0;
          if (summaryResponse.content) {
            session.conversationHistory.push({ role: 'assistant', content: summaryResponse.content });
            tokensUsed = summaryResponse.tokensUsed || 0;
            session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
            session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
          }

          await processAgentResponse(
            summaryResponse.content || '',
            session,
            this.dbManager,
            this.sessionManager,
            worker,
            tokensUsed,
            originalTimestamp,
            'OpenAI-Compatible'
          );
        }
      }

      const sessionDuration = Date.now() - session.startTime;
      logger.success('SDK', 'OpenAI Compatible agent completed', {
        sessionId: session.sessionDbId,
        duration: `${(sessionDuration / 1000).toFixed(1)}s`,
        historyLength: session.conversationHistory.length,
        model: config.model,
        baseUrl: config.baseUrl
      });

    } catch (error: unknown) {
      if (isAbortError(error)) {
        logger.warn('SDK', 'OpenAI Compatible agent aborted', { sessionId: session.sessionDbId });
        throw error;
      }

      if (shouldFallbackToClaude(error) && this.fallbackAgent) {
        logger.warn('SDK', 'OpenAI Compatible API failed, falling back to Claude SDK', {
          sessionDbId: session.sessionDbId,
          error: error instanceof Error ? error.message : String(error),
          historyLength: session.conversationHistory.length
        });

        return this.fallbackAgent.startSession(session, worker);
      }

      logger.failure('SDK', 'OpenAI Compatible agent error', { sessionDbId: session.sessionDbId }, error as Error);
      throw error;
    }
  }

  /**
   * Fetch available models from the API
   */
  async listModels(): Promise<OpenAICompatibleModel[]> {
    const config = this.getConfig();

    if (!config.baseUrl || !config.apiKey) {
      throw new Error('OpenAI Compatible URL and API key must be configured');
    }

    // Construct models endpoint
    const modelsUrl = config.baseUrl.replace(/\/chat\/completions\/?$/, '/models')
      .replace(/\/$/, '') + '/models';

    // Normalize URL: avoid double /models
    const normalizedUrl = modelsUrl.replace(/\/models\/models$/, '/models');

    logger.debug('SDK', 'Fetching models from OpenAI Compatible API', { url: normalizedUrl });

    const response = await fetch(normalizedUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch models: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as OpenAIModelsResponse;

    if (data.error) {
      throw new Error(`API error: ${data.error.message || data.error.code}`);
    }

    return data.data || [];
  }

  /**
   * Estimate token count from text
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  /**
   * Truncate conversation history to prevent runaway context
   */
  private truncateHistory(history: ConversationMessage[]): ConversationMessage[] {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    const MAX_CONTEXT_MESSAGES = parseInt(settings.CLAUDE_MEM_OPENAI_COMPATIBLE_MAX_CONTEXT_MESSAGES) || DEFAULT_MAX_CONTEXT_MESSAGES;
    const MAX_ESTIMATED_TOKENS = parseInt(settings.CLAUDE_MEM_OPENAI_COMPATIBLE_MAX_TOKENS) || DEFAULT_MAX_ESTIMATED_TOKENS;

    if (history.length <= MAX_CONTEXT_MESSAGES) {
      const totalTokens = history.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
      if (totalTokens <= MAX_ESTIMATED_TOKENS) {
        return history;
      }
    }

    const truncated: ConversationMessage[] = [];
    let tokenCount = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (truncated.length >= MAX_CONTEXT_MESSAGES || tokenCount + msgTokens > MAX_ESTIMATED_TOKENS) {
        logger.warn('SDK', 'Context window truncated', {
          originalMessages: history.length,
          keptMessages: truncated.length,
          droppedMessages: i + 1,
          estimatedTokens: tokenCount,
          tokenLimit: MAX_ESTIMATED_TOKENS
        });
        break;
      }

      truncated.unshift(msg);
      tokenCount += msgTokens;
    }

    return truncated;
  }

  /**
   * Convert conversation history to OpenAI message format
   */
  private conversationToOpenAIMessages(history: ConversationMessage[]): OpenAIMessage[] {
    return history.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));
  }

  /**
   * Fetch with timeout support
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch with retry and exponential backoff
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = MAX_RETRIES
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, options);

        // Don't retry on client errors (4xx) except 429 (rate limit)
        if (!response.ok && response.status !== 429 && response.status >= 400 && response.status < 500) {
          return response; // Return to let caller handle the error
        }

        // Retry on server errors (5xx) and rate limits (429)
        if (!response.ok && (response.status >= 500 || response.status === 429)) {
          if (attempt < maxRetries) {
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt); // Exponential backoff
            logger.warn('SDK', `OpenAI Compatible API error ${response.status}, retrying in ${delay}ms`, {
              attempt: attempt + 1,
              maxRetries,
              status: response.status
            });
            await this.sleep(delay);
            continue;
          }
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Retry on network errors
        if (attempt < maxRetries) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          logger.warn('SDK', `OpenAI Compatible API network error, retrying in ${delay}ms`, {
            attempt: attempt + 1,
            maxRetries,
            error: lastError.message
          });
          await this.sleep(delay);
          continue;
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Query the OpenAI Compatible API
   */
  private async queryAPI(
    history: ConversationMessage[],
    config: { baseUrl: string; apiKey: string; model: string }
  ): Promise<{ content: string; tokensUsed?: number }> {
    const truncatedHistory = this.truncateHistory(history);
    const messages = this.conversationToOpenAIMessages(truncatedHistory);

    logger.debug('SDK', `Querying OpenAI Compatible API (${config.model})`, {
      turns: truncatedHistory.length,
      baseUrl: config.baseUrl
    });

    // Construct the chat completions endpoint
    let endpoint = config.baseUrl;
    if (!endpoint.includes('/chat/completions')) {
      endpoint = endpoint.replace(/\/$/, '') + '/chat/completions';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Only add Authorization header if API key is provided
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await this.fetchWithRetry(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI Compatible API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as OpenAICompatibleResponse;

    if (data.error) {
      throw new Error(`API error: ${data.error.code || data.error.type} - ${data.error.message}`);
    }

    if (!data.choices?.[0]?.message?.content) {
      logger.warn('SDK', 'Empty response from OpenAI Compatible API');
      return { content: '' };
    }

    const content = data.choices[0].message.content;
    const tokensUsed = data.usage?.total_tokens;

    if (tokensUsed) {
      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;

      logger.info('SDK', 'OpenAI Compatible API usage', {
        model: config.model,
        inputTokens,
        outputTokens,
        totalTokens: tokensUsed,
        messagesInContext: truncatedHistory.length
      });

      if (tokensUsed > 50000) {
        logger.warn('SDK', 'High token usage detected', {
          totalTokens: tokensUsed
        });
      }
    }

    return { content, tokensUsed };
  }

  /**
   * Get configuration from settings
   */
  private getConfig(): { baseUrl: string; apiKey: string; model: string } {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    const baseUrl = settings.CLAUDE_MEM_OPENAI_COMPATIBLE_URL || '';
    const apiKey = settings.CLAUDE_MEM_OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY || '';
    const model = settings.CLAUDE_MEM_OPENAI_COMPATIBLE_MODEL || 'gpt-3.5-turbo';

    return { baseUrl, apiKey, model };
  }
}

/**
 * Check if OpenAI Compatible is available (has URL configured)
 * Note: API key is optional for local servers like Ollama
 */
export function isOpenAICompatibleAvailable(): boolean {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  const hasUrl = !!settings.CLAUDE_MEM_OPENAI_COMPATIBLE_URL;
  return hasUrl;
}

/**
 * Check if OpenAI Compatible is the selected provider
 */
export function isOpenAICompatibleSelected(): boolean {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  return settings.CLAUDE_MEM_PROVIDER === 'openai-compatible';
}
