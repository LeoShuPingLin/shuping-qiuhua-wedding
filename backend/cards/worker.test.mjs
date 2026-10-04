import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstructions, countCharacters, createHandler, normalizePayload } from './worker.mjs';

const ORIGIN = 'https://leoshupinglin.github.io';
const ENV = {
  ALLOWED_ORIGIN: ORIGIN,
  OPENAI_MODEL: 'gpt-6.1-sol',
  OPENAI_API_KEY: 'test-openai-key',
  CARD_ACCESS_TOKEN: 'this-is-a-long-test-access-token'
};

function profile(overrides = {}) {
  return {
    name: '舅媽',
    author: '書平',
    generation: '長輩',
    story: '從小回彰化都會住舅媽家，她總是準備很多好吃的，也很關心我們全家。',
    tone: 'AI 自動判斷',
    pronoun: 'AI 自動判斷',
    minLength: 150,
    maxLength: 160,
    signature: '書平 ＆ 秋華',
    ...overrides
  };
}

function cardOfLength(length, marker = '謝') {
  const start = '舅媽：';
  const end = '書平 ＆ 秋華';
  const remaining = length - countCharacters(start + end);
  assert.ok(remaining > 0);
  return `${start}${marker.repeat(remaining)}\n${end}`;
}

function openAIResponse(value, status = 200) {
  return new Response(JSON.stringify(status === 200
    ? { output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }
    : { error: { code: 'test_error' } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'upstream-test-id' }
  });
}

function workerRequest(path, { method = 'POST', body, token = ENV.CARD_ACCESS_TOKEN, origin = ORIGIN } = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      Origin: origin,
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

test('counts Unicode characters while excluding whitespace', () => {
  assert.equal(countCharacters('舅媽：\n謝謝您 ♡'), 7);
});

test('normalizes one free-form story and rejects an invalid range', () => {
  const normalized = normalizePayload({ action: 'generate', profile: profile() });
  assert.equal(normalized.profile.story.includes('彰化'), true);
  assert.equal(normalized.profile.minLength, 150);
  assert.throws(() => normalizePayload({ action: 'generate', profile: profile({ minLength: 200, maxLength: 160 }) }), /字數範圍/);
});

test('instructions tell the model to silently parse notes without inventing facts', () => {
  const instructions = buildInstructions(normalizePayload({ action: 'generate', profile: profile() }));
  assert.match(instructions, /先在心中解析/);
  assert.match(instructions, /不得補寫/);
  assert.match(instructions, /150～160/);
  assert.match(instructions, /書平/);
});

test('health requires the correct origin and access token', async () => {
  const handler = createHandler({ fetchImpl: async () => { throw new Error('unused'); } });
  const ok = await handler(workerRequest('/health', { method: 'GET' }), ENV);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, model: 'gpt-6.1-sol' });

  const unauthorized = await handler(workerRequest('/health', { method: 'GET', token: 'wrong' }), ENV);
  assert.equal(unauthorized.status, 401);

  const forbidden = await handler(workerRequest('/health', { method: 'GET', origin: 'https://example.com' }), ENV);
  assert.equal(forbidden.status, 403);
});

test('generate sends a server-built structured request and returns two variants', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return openAIResponse({ variants: [cardOfLength(155, '謝'), cardOfLength(158, '暖')] });
  };
  const handler = createHandler({ fetchImpl });
  const response = await handler(workerRequest('/generate', {
    body: { action: 'generate', profile: profile(), prompt: '這段前端 prompt 必須被忽略' }
  }), ENV);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.variants.length, 2);
  assert.deepEqual(data.counts, [155, 158]);
  assert.equal(data.withinRange, true);
  assert.equal(data.retried, false);
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(captured.init.headers.Authorization, 'Bearer test-openai-key');
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.text.format.type, 'json_schema');
  assert.equal(captured.body.text.format.strict, true);
  assert.match(captured.body.input, /彰化/);
  assert.doesNotMatch(captured.body.input, /前端 prompt 必須被忽略/);
});

test('automatically retries once when generated cards miss the character range', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? openAIResponse({ variants: ['太短', '也太短'] })
      : openAIResponse({ variants: [cardOfLength(150, '真'), cardOfLength(160, '暖')] });
  };
  const handler = createHandler({ fetchImpl });
  const response = await handler(workerRequest('/generate', { body: { action: 'generate', profile: profile() } }), ENV);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(data.retried, true);
  assert.equal(data.withinRange, true);
  assert.deepEqual(data.counts, [150, 160]);
});

test('revision returns one checked card and validates required text', async () => {
  const handler = createHandler({ fetchImpl: async () => openAIResponse({ text: cardOfLength(152, '愛') }) });
  const response = await handler(workerRequest('/generate', {
    body: { action: 'revise', profile: profile(), text: '原本的小卡內容', instruction: '更像真人手寫' }
  }), ENV);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(countCharacters(data.text), 152);
  assert.equal(data.withinRange, true);

  const invalid = await handler(workerRequest('/generate', {
    body: { action: 'revise', profile: profile(), text: '', instruction: '更口語' }
  }), ENV);
  assert.equal(invalid.status, 400);
});
