import { DEFAULT_FIND_MODEL, err, ok, type Result } from '../core/index.js';
import {
  FIND_CHOICE_LIMIT,
  FIND_CHUNK_SIZE,
  FIND_CONTAINER_CUMULATIVE,
  FIND_EXISTS_ABSENT,
  FIND_EXISTS_MATCHED,
  FIND_MAX_CONTAINERS,
  FIND_PREVIEW_LIMIT,
  FIND_TOP_PER_CHUNK,
  assignCatalogIds,
  truncateFindText,
  type CatalogEntry,
  type FindCandidate,
} from './catalog.js';
import {
  activeFindClient,
  upstreamFrom,
  type FindCall,
  type FindQuestion,
  type FindResponse,
  type FindSystemOne,
} from './client.js';

export interface FindMatch {
  target: string;
  score: number;
  kind: string;
  name?: string;
  text?: string;
  slide?: number;
}

export interface FindResultValue {
  query: string;
  verdict: 'matched' | 'partial' | 'absent';
  exists: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  matches: FindMatch[];
}

export interface RankFindInput {
  candidates: readonly FindCandidate[];
  query: string;
  limit?: number;
  model?: string;
  client?: FindSystemOne;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
}

interface FindGroup {
  id: string;
  entries: CatalogEntry[];
}

const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

const addUsage = (left: Usage, response: FindResponse): Usage => ({
  input_tokens: left.input_tokens + (response.usage?.input_tokens ?? 0),
  output_tokens: left.output_tokens + (response.usage?.output_tokens ?? 0),
});

const choiceQuestion = (instructions: string, ids: readonly string[]): FindQuestion => {
  const criteria: Record<string, string | null> = {};
  for (const id of ids) criteria[id] = null;
  return { type: 'choice', instructions, criteria };
};

const existsQuestion = (query: string): FindQuestion => ({
  type: 'noul',
  instructions: `Does any element directly match this request: ${JSON.stringify(query)}?`,
  criteria: {
    true: 'At least one element states or directly matches the request',
    false: 'No element addresses this request',
  },
});

const matchQuestion = (query: string, id: string): FindQuestion => ({
  type: 'noul',
  instructions: `Does element ${id} directly match this request: ${JSON.stringify(query)}?`,
  criteria: {
    true: 'This element is a direct match',
    false: 'This element does not match',
  },
});

const elementState = (entries: readonly CatalogEntry[]): Record<string, unknown> => ({
  elements: entries.map((entry) => {
    const text = truncateFindText(entry.text);
    const row: Record<string, string> = {
      id: entry.id,
      where: entry.container,
      kind: entry.kind,
    };
    if (entry.name) row['name'] = entry.name;
    if (text) row['text'] = text;
    if (entry.place) row['place'] = entry.place;
    return row;
  }),
});

const containerState = (groups: readonly FindGroup[]): Record<string, unknown> => ({
  containers: groups.map((group) => {
    const first = group.entries[0];
    const last = group.entries[group.entries.length - 1];
    return {
      id: group.id,
      where: first?.container ?? '',
      ids: first && last ? `${first.id}..${last.id}` : '',
      count: group.entries.length,
      sample: group.entries.slice(0, 6).map((entry) => {
        const text = truncateFindText(entry.text, 80);
        const row: Record<string, string> = { id: entry.id, kind: entry.kind };
        if (entry.name) row['name'] = entry.name;
        if (text) row['text'] = text;
        return row;
      }),
    };
  }),
});

const windowsOf = (entries: readonly CatalogEntry[]): CatalogEntry[][] => {
  const byContainer = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const list = byContainer.get(entry.container) ?? [];
    list.push(entry);
    byContainer.set(entry.container, list);
  }
  const groups: CatalogEntry[][] = [];
  for (const list of byContainer.values()) {
    if (list.length <= FIND_CHUNK_SIZE) {
      groups.push(list);
      continue;
    }
    for (let index = 0; index < list.length; index += FIND_CHUNK_SIZE)
      groups.push(list.slice(index, index + FIND_CHUNK_SIZE));
  }
  return groups;
};

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
};

const toMatch = (entry: CatalogEntry, score: number): FindMatch => {
  const text = truncateFindText(entry.text, FIND_PREVIEW_LIMIT);
  return {
    target: entry.target,
    score,
    kind: entry.kind,
    ...(entry.name ? { name: entry.name } : {}),
    ...(text ? { text } : {}),
    ...(entry.slide !== undefined ? { slide: entry.slide } : {}),
  };
};

const byScore = (
  left: { id: string; score: number },
  right: { id: string; score: number },
): number => right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

const choiceProbabilities = (
  response: FindResponse,
  key: string,
): Result<Record<string, number>> => {
  const answer = response.answers[key];
  if (answer?.type !== 'choice' || !answer.probabilities)
    return err('UPSTREAM_ERROR', `TypeSafe response is missing choice probabilities for ${key}`);
  return ok(answer.probabilities);
};

const noulValue = (response: FindResponse, key: string): Result<number> => {
  const answer = response.answers[key];
  const noul = answer?.type === 'noul' ? answer.noul : undefined;
  if (noul === undefined || !Number.isFinite(noul))
    return err('UPSTREAM_ERROR', `TypeSafe response is missing a noul answer for ${key}`);
  return ok(noul);
};

const verdictOf = (exists: number): FindResultValue['verdict'] => {
  if (exists >= FIND_EXISTS_MATCHED) return 'matched';
  if (exists < FIND_EXISTS_ABSENT) return 'absent';
  return 'partial';
};

const finish = (
  query: string,
  exists: number,
  ranked: readonly { entry: CatalogEntry; score: number }[],
  limit: number,
  model: string,
  usage: Usage,
): Result<FindResultValue> => {
  const verdict = verdictOf(exists);
  const matches =
    verdict === 'absent'
      ? []
      : ranked.slice(0, limit).map((item) => toMatch(item.entry, item.score));
  return ok(
    { query, verdict, exists, model, usage, matches },
    verdict === 'partial'
      ? [
          {
            severity: 'warning',
            code: 'FIND_PARTIAL',
            message: `Query is only partially addressed (exists ${exists.toFixed(2)}). Review matches before editing.`,
          },
        ]
      : [],
  );
};

const rankScores = (
  entries: readonly CatalogEntry[],
  probabilities: Readonly<Record<string, number>>,
): { entry: CatalogEntry; score: number }[] =>
  entries
    .map((entry) => ({ entry, score: probabilities[entry.id] ?? 0, id: entry.id }))
    .sort(byScore);

export const rankFind = async (input: RankFindInput): Promise<Result<FindResultValue>> => {
  const model = input.model ?? DEFAULT_FIND_MODEL;
  const limit = input.limit ?? 8;
  const entries = assignCatalogIds(input.candidates);
  if (entries.length === 0) {
    return ok({
      query: input.query,
      verdict: 'absent',
      exists: 0,
      model,
      usage: EMPTY_USAGE,
      matches: [],
    });
  }

  const client = activeFindClient(input.client);
  let usage = EMPTY_USAGE;
  let modelSeen = model;

  const call = async (
    state: Record<string, unknown>,
    questions: Record<string, FindQuestion>,
  ): Promise<Result<FindResponse>> => {
    const request: FindCall = { state, model, questions };
    try {
      const response = await client(request);
      usage = addUsage(usage, response);
      if (response.model) modelSeen = response.model;
      return ok(response);
    } catch (cause) {
      return upstreamFrom(cause);
    }
  };

  const rankWindow = async (window: readonly CatalogEntry[]): Promise<Result<FindResultValue>> => {
    const called = await call(elementState(window), {
      where: choiceQuestion(
        `Which element best matches this request: ${JSON.stringify(input.query)}?`,
        window.map((entry) => entry.id),
      ),
      exists: existsQuestion(input.query),
    });
    if (!called.ok) return called;
    const probabilities = choiceProbabilities(called.value, 'where');
    if (!probabilities.ok) return probabilities;
    const exists = noulValue(called.value, 'exists');
    if (!exists.ok) return exists;
    return finish(
      input.query,
      exists.value,
      rankScores(window, probabilities.value),
      limit,
      modelSeen,
      usage,
    );
  };

  if (entries.length <= FIND_CHOICE_LIMIT) return rankWindow(entries);

  const groups: FindGroup[] = windowsOf(entries).map((group, index) => ({
    id: `C${String(index + 1).padStart(3, '0')}`,
    entries: group,
  }));

  const selectGroups = (
    batch: readonly FindGroup[],
    probabilities: Readonly<Record<string, number>>,
  ): FindGroup[] => {
    const ranked = [...batch].sort((left, right) =>
      byScore(
        { id: left.id, score: probabilities[left.id] ?? 0 },
        { id: right.id, score: probabilities[right.id] ?? 0 },
      ),
    );
    const selected: FindGroup[] = [];
    let cumulative = 0;
    for (const group of ranked) {
      if (selected.length >= FIND_MAX_CONTAINERS) break;
      selected.push(group);
      cumulative += probabilities[group.id] ?? 0;
      if (cumulative >= FIND_CONTAINER_CUMULATIVE) break;
    }
    return selected;
  };

  const chooseGroups = async (batch: readonly FindGroup[]): Promise<Result<FindGroup[]>> => {
    const called = await call(containerState(batch), {
      where: choiceQuestion(
        `Which section best matches this request: ${JSON.stringify(input.query)}?`,
        batch.map((group) => group.id),
      ),
    });
    if (!called.ok) return called;
    const probabilities = choiceProbabilities(called.value, 'where');
    if (!probabilities.ok) return probabilities;
    return ok(selectGroups(batch, probabilities.value));
  };

  let selected: CatalogEntry[] = [];
  if (groups.length === 1) {
    selected = groups[0]?.entries ?? [];
  } else {
    for (const batch of chunk(groups, FIND_CHOICE_LIMIT)) {
      const chosen = await chooseGroups(batch);
      if (!chosen.ok) return chosen;
      for (const group of chosen.value) selected.push(...group.entries);
    }
  }

  if (selected.length <= FIND_CHOICE_LIMIT) return rankWindow(selected);

  // Choice probabilities sum to 1 inside one window, so they cannot be compared across chunks.
  const heads: CatalogEntry[] = [];
  for (const part of chunk(selected, FIND_CHOICE_LIMIT)) {
    const called = await call(elementState(part), {
      where: choiceQuestion(
        `Which element best matches this request: ${JSON.stringify(input.query)}?`,
        part.map((entry) => entry.id),
      ),
    });
    if (!called.ok) return called;
    const probabilities = choiceProbabilities(called.value, 'where');
    if (!probabilities.ok) return probabilities;
    heads.push(
      ...rankScores(part, probabilities.value)
        .slice(0, FIND_TOP_PER_CHUNK)
        .map((item) => item.entry),
    );
  }

  const rescored: { entry: CatalogEntry; score: number }[] = [];
  let exists = 0;
  for (const headChunk of chunk(heads, FIND_CHOICE_LIMIT - 1)) {
    const questions: Record<string, FindQuestion> = { exists: existsQuestion(input.query) };
    for (const entry of headChunk)
      questions[`match_${entry.id}`] = matchQuestion(input.query, entry.id);
    const called = await call(elementState(headChunk), questions);
    if (!called.ok) return called;
    const existsAnswer = noulValue(called.value, 'exists');
    if (!existsAnswer.ok) return existsAnswer;
    exists = Math.max(exists, existsAnswer.value);
    for (const entry of headChunk) {
      const score = noulValue(called.value, `match_${entry.id}`);
      if (!score.ok) return score;
      rescored.push({ entry, score: score.value });
    }
  }
  rescored.sort((left, right) =>
    byScore({ id: left.entry.id, score: left.score }, { id: right.entry.id, score: right.score }),
  );
  return finish(input.query, exists, rescored, limit, modelSeen, usage);
};
