import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  RateLimitError,
  TypeSafeClient,
  choice,
  noul,
  type EntryType,
  type Questions,
} from '@typesafe-ai/sdk';
import { err, type Result } from '../core/index.js';

export interface FindQuestion {
  type: 'choice' | 'noul';
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface FindCall {
  state: Readonly<Record<string, unknown>>;
  model: string;
  questions: Readonly<Record<string, FindQuestion>>;
}

export interface FindAnswer {
  type: 'choice' | 'noul';
  choice?: string;
  probabilities?: Record<string, number>;
  noul?: number;
}

export interface FindResponse {
  model: string;
  answers: Record<string, FindAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export type FindSystemOne = (request: FindCall) => Promise<FindResponse>;

export class FindConfigError extends Error {
  override readonly name = 'FindConfigError';
}

let injected: FindSystemOne | undefined;

/** Test hook. Production calls TypeSafe when this is unset. */
export const injectFindClient = (client: FindSystemOne | undefined): void => {
  injected = client;
};

const readApiKey = (): string | undefined => {
  const value = process.env['TYPESAFE_API_KEY']?.trim();
  if (!value) return undefined;
  return value;
};

const toQuestions = (questions: Readonly<Record<string, FindQuestion>>): Questions => {
  const mapped: Questions = {};
  for (const [key, question] of Object.entries(questions)) {
    if (question.type === 'choice') {
      mapped[key] = choice(question.instructions, question.criteria);
      continue;
    }
    const yes = question.criteria['true'];
    const no = question.criteria['false'];
    mapped[key] = noul(question.instructions, {
      ...(yes != null ? { true: yes } : {}),
      ...(no != null ? { false: no } : {}),
    });
  }
  return mapped;
};

export const createFindSystemOne = (): FindSystemOne => {
  let client: TypeSafeClient | undefined;
  return async (request) => {
    const apiKey = readApiKey();
    if (!apiKey) throw new FindConfigError('TYPESAFE_API_KEY is not set');
    client ??= new TypeSafeClient({ apiKey, timeout: 120_000, logLevel: 'off' });
    const result = await client.systemOne({
      state: request.state as EntryType,
      model: request.model,
      questions: toQuestions(request.questions),
    });
    const answers: Record<string, FindAnswer> = {};
    for (const [key, answer] of Object.entries(result.answers)) {
      if (answer.type === 'noul') {
        answers[key] = { type: 'noul', noul: answer.noul };
        continue;
      }
      if (answer.type === 'choice') {
        answers[key] = {
          type: 'choice',
          choice: answer.choice,
          probabilities: { ...answer.probabilities },
        };
      }
    }
    return {
      model: result.model,
      answers,
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
      },
    };
  };
};

export const activeFindClient = (override?: FindSystemOne): FindSystemOne =>
  override ?? injected ?? createFindSystemOne();

export const upstreamFrom = (cause: unknown): Result<never> => {
  if (cause instanceof FindConfigError) {
    return err('UPSTREAM_ERROR', cause.message, [], {
      hint: 'Export TYPESAFE_API_KEY from https://console.typesafe.ai/keys. find sends element names and visible text to api.typesafe.ai.',
    });
  }
  if (cause instanceof AuthenticationError) {
    return err('UPSTREAM_ERROR', 'TypeSafe rejected the API key', [], {
      hint: 'Check TYPESAFE_API_KEY at https://console.typesafe.ai/keys.',
    });
  }
  if (cause instanceof RateLimitError) {
    return err('UPSTREAM_ERROR', 'TypeSafe rate limit exceeded', [], {
      hint: 'Wait and retry. The client already retried HTTP 429.',
    });
  }
  if (cause instanceof APITimeoutError || cause instanceof APIConnectionError) {
    return err('UPSTREAM_ERROR', 'TypeSafe request failed', [], {
      hint: cause.message,
    });
  }
  if (cause instanceof APIError) {
    return err('UPSTREAM_ERROR', `TypeSafe request failed (${String(cause.status)})`, [], {
      hint: cause.message,
    });
  }
  const message = cause instanceof Error ? cause.message : 'TypeSafe request failed';
  return err('UPSTREAM_ERROR', message);
};
