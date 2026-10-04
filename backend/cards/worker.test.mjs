import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageLimiter, buildInstructions, countCharacters, createHandler, normalizePayload } from './worker.mjs';

const ORIGIN = 'https://leoshupinglin.github.io';
const ENV = {
  ALLOWED_ORIGIN: ORIGIN,
  OPENAI_API_KEY: 'test-openai-key',
  CARD_ACCESS_TOKEN: 'this-is-a-long-test-access-token'
};

function profile(overrides = {}) {
  return {
    name: '舅媽',
    author: '書平',
    relation: '親戚',
    generation: '長輩',
    closeness: '非常親近',
    quality: 'premium',
    traits: ['溫暖', '善於傾聽'],
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
    ? { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }
    : { error: { code: 'test_error' } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'upstream-test-id' }
  });
}

function makeUsageClient({ totalLimit = 100, dailyLimit = 30 } = {}) {
  let used = 0;
  const operations = [];
  const client = async (_env, operation) => {
    operations.push(operation);
    if (operation === 'reserve') used += 1;
    return {
      allowed: true,
      total: { used, limit: totalLimit, remaining: totalLimit - used },
      today: { date: '2026-10-04', used, limit: dailyLimit, remaining: dailyLimit - used }
    };
  };
  client.operations = operations;
  return client;
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
  assert.equal(normalized.profile.relation, '親戚');
  assert.equal(normalized.profile.closeness, '非常親近');
  assert.equal(normalized.profile.quality, 'premium');
  assert.deepEqual(normalized.profile.traits, ['溫暖', '善於傾聽']);
  assert.equal(normalized.profile.minLength, 150);
  assert.throws(() => normalizePayload({ action: 'generate', profile: profile({ minLength: 200, maxLength: 160 }) }), /字數範圍/);
  assert.throws(() => normalizePayload({ action: 'generate', profile: profile({ traits: ['不存在的個性'] }) }), /個性選項/);
  assert.throws(() => normalizePayload({ action: 'generate', profile: profile({ quality: 'arbitrary-model' }) }), /寫作品質/);
});

test('instructions tell the model to silently parse notes without inventing facts', () => {
  const instructions = buildInstructions(normalizePayload({ action: 'generate', profile: profile() }));
  assert.match(instructions, /先在心中解析/);
  assert.match(instructions, /不得補寫/);
  assert.match(instructions, /關係類型為「親戚」/);
  assert.match(instructions, /彼此非常親近/);
  assert.match(instructions, /溫暖、善於傾聽/);
  assert.match(instructions, /150～160/);
  assert.match(instructions, /書平/);
  assert.match(instructions, /熟悉程度.*只是寫作參數/);
  assert.match(instructions, /寧可使用溫暖自然的婚宴小卡公版/);
  assert.match(instructions, /既然不熟，為什麼邀請我/);
});

test('health requires the correct origin and access token', async () => {
  const usageClient = makeUsageClient();
  const handler = createHandler({ fetchImpl: async () => { throw new Error('unused'); }, usageClient });
  const ok = await handler(workerRequest('/health', { method: 'GET' }), ENV);
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.ok, true);
  assert.deepEqual(data.models, { premium: 'gpt-6-astra', balanced: 'gpt-6.1-sol' });
  assert.equal(data.apiCallsPerClick, 1);
  assert.equal(data.usage.total.remaining, 100);
  assert.deepEqual(usageClient.operations, ['status']);

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
  const usageClient = makeUsageClient();
  const handler = createHandler({ fetchImpl, usageClient });
  const response = await handler(workerRequest('/generate', {
    body: { action: 'generate', profile: profile(), prompt: '這段前端 prompt 必須被忽略' }
  }), ENV);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.variants.length, 2);
  assert.deepEqual(data.counts, [155, 158]);
  assert.equal(data.withinRange, true);
  assert.equal(data.apiCalls, 1);
  assert.equal(data.model, 'gpt-6-astra');
  assert.equal(data.usage.total.remaining, 99);
  assert.deepEqual(usageClient.operations, ['reserve']);
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(captured.init.headers.Authorization, 'Bearer test-openai-key');
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.model, 'gpt-6-astra');
  assert.equal(captured.body.text.format.type, 'json_schema');
  assert.equal(captured.body.text.format.strict, true);
  assert.match(captured.body.input, /彰化/);
  assert.match(captured.body.input, /親戚/);
  assert.match(captured.body.input, /善於傾聽/);
  assert.doesNotMatch(captured.body.input, /前端 prompt 必須被忽略/);
});

test('balanced quality selects GPT-6.1 Sol without accepting an arbitrary model name', async () => {
  let model;
  const handler = createHandler({
    fetchImpl: async (_url, init) => {
      model = JSON.parse(init.body).model;
      return openAIResponse({ variants: [cardOfLength(150, '真'), cardOfLength(160, '暖')] });
    },
    usageClient: makeUsageClient()
  });
  const response = await handler(workerRequest('/generate', {
    body: { action: 'generate', profile: profile({ quality: 'balanced' }) }
  }), ENV);

  assert.equal(response.status, 200);
  assert.equal(model, 'gpt-6.1-sol');
  assert.equal((await response.json()).quality, 'balanced');
});

test('reports an incomplete structured response clearly and never retries it', async () => {
  let calls = 0;
  const usageClient = makeUsageClient();
  const handler = createHandler({
    fetchImpl: async () => {
      calls += 1;
      return Response.json({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{ content: [{ type: 'output_text', text: '{"variants":["未完成' }] }]
      });
    },
    usageClient
  });
  const response = await handler(workerRequest('/generate', {
    body: { action: 'generate', profile: profile() }
  }), ENV);
  const data = await response.json();

  assert.equal(response.status, 502);
  assert.equal(data.error, 'incomplete_model_response');
  assert.match(data.message, /回覆未完成/);
  assert.equal(calls, 1);
  assert.deepEqual(usageClient.operations, ['reserve']);
});

test('does not automatically retry when generated cards miss the character range', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return openAIResponse({ variants: ['太短', '也太短'] });
  };
  const usageClient = makeUsageClient();
  const handler = createHandler({ fetchImpl, usageClient });
  const response = await handler(workerRequest('/generate', { body: { action: 'generate', profile: profile() } }), ENV);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(data.apiCalls, 1);
  assert.equal(data.withinRange, false);
  assert.deepEqual(data.counts, [2, 3]);
  assert.deepEqual(usageClient.operations, ['reserve']);
});

test('replaces insulting distance language with a warm public-card fallback without another API call', async () => {
  let calls = 0;
  const handler = createHandler({
    fetchImpl: async () => {
      calls += 1;
      return openAIResponse({
        variants: [
          '芳瑜，雖然我們還不太熟，但很高興能藉著這張小卡跟妳打聲招呼。妳是學弟的女朋友，希望往後能多聊幾句，慢慢熟悉彼此。書平 ＆ 秋華',
          '芳瑜，現在提起妳，我還是會說是學弟的女朋友；希望以後有機會能多認識妳一些。雖然彼此互動不多，還是想把祝福送給妳。書平 ＆ 秋華'
        ]
      });
    },
    usageClient: makeUsageClient()
  });
  const response = await handler(workerRequest('/generate', {
    body: {
      action: 'generate',
      profile: profile({
        name: '芳瑜',
        closeness: '較少互動',
        story: '她是學弟的女朋友，明年準備結婚。'
      })
    }
  }), ENV);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(data.apiCalls, 1);
  assert.equal(data.usedSafeFallback, true);
  assert.equal(data.withinRange, true);
  assert.deepEqual(data.counts, [156, 150]);
  for (const text of data.variants) {
    assert.doesNotMatch(text, /不太熟|互動不多|學弟的女朋友|慢慢熟悉|多認識/);
    assert.match(text, /婚禮/);
    assert.match(text, /祝福/);
  }
});

test('revision returns one checked card and validates required text', async () => {
  const handler = createHandler({ fetchImpl: async () => openAIResponse({ text: cardOfLength(152, '愛') }), usageClient: makeUsageClient() });
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

test('durable usage limiter enforces a persistent hard cap and status checks do not consume it', async () => {
  class MemoryStorage {
    constructor() { this.values = new Map(); }
    async transaction(callback) { return callback(this); }
    async get(key) { return this.values.get(key); }
    async put(key, value) { this.values.set(key, value); }
  }

  const limiter = new UsageLimiter(
    { storage: new MemoryStorage() },
    { CARD_TOTAL_LIMIT: '2', CARD_DAILY_LIMIT: '2' }
  );
  const call = operation => limiter.fetch(new Request('https://usage.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, timestamp: Date.UTC(2026, 9, 4, 12) })
  }));

  const initial = await (await call('status')).json();
  assert.equal(initial.total.used, 0);
  assert.equal((await call('reserve')).status, 200);
  assert.equal((await call('reserve')).status, 200);
  const blocked = await call('reserve');
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, 'total_limit_reached');

  const finalStatus = await (await call('status')).json();
  assert.equal(finalStatus.total.used, 2);
  assert.equal(finalStatus.total.remaining, 0);
});
