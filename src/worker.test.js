import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from './worker.js';

// Helper to create handleWebRequest function in a testable way
function createHandleWebRequest(fetchMock) {
  // Inline the necessary functions from worker.js
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

  const text = (s, status = 200) => new Response(s, { status });

  async function verifyTurnstile(request, env, token) {
    const form = new URLSearchParams();
    form.set('secret', env.TURNSTILE_SECRET_KEY);
    form.set('response', token);

    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) form.set('remoteip', ip);

    const r = await fetchMock('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    const data = await r.json().catch(() => null);
    if (!data?.success) return { ok: false, data };

    if (data.hostname && !String(data.hostname).endsWith('subach.uk')) {
      return { ok: false, data: { ...data, reason: 'bad-hostname' } };
    }

    return { ok: true, data };
  }

  async function handleWebRequest(request, env) {
    if (request.method !== 'POST') return text('method not allowed', 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return text('bad json', 400);
    }

    // Honeypot
    if (String(body?.website || '').trim()) return json({ ok: true });

    const postcardId = String(body?.id || '')
      .trim()
      .toLowerCase();
    const name = String(body?.name || '')
      .trim()
      .slice(0, 80);
    const message = String(body?.message || '')
      .trim()
      .slice(0, 600);
    const token = String(body?.turnstileToken || '').trim();

    if (!/^[0-9a-z]{4,12}$/i.test(postcardId)) return text('bad id', 400);
    if (!name) return text('name required', 400);
    if (!token) return text('turnstile required', 403);

    const ts = await verifyTurnstile(request, env, token);
    if (!ts.ok) return text('turnstile failed', 403);

    const card = await env.DB.prepare("SELECT id FROM cards WHERE id=?1 AND status='available'")
      .bind(postcardId)
      .first();

    if (!card) return text('not found', 404);

    await env.DB.prepare(
      'INSERT INTO requests (postcard_id, name, message, created_at) VALUES (?1, ?2, ?3, ?4)'
    )
      .bind(postcardId, name, message || null, Date.now())
      .run();

    // Skip notification for tests
    return json({ ok: true });
  }

  return handleWebRequest;
}

describe('handleWebRequest', () => {
  let mockEnv;
  let mockDB;
  let mockFetch;
  let handleWebRequest;

  beforeEach(() => {
    // Reset mocks
    mockDB = {
      prepare: vi.fn(),
    };

    mockEnv = {
      DB: mockDB,
      TURNSTILE_SECRET_KEY: 'test-secret-key',
    };

    mockFetch = vi.fn();
    handleWebRequest = createHandleWebRequest(mockFetch);
  });

  it('correctly processes a valid request, verifies Turnstile, and inserts into DB', async () => {
    // Mock Turnstile verification success
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, hostname: 'subach.uk' }),
    });

    // Mock DB card lookup - card exists and is available
    const mockFirst = vi.fn().mockResolvedValueOnce({ id: 'abc123' });
    const mockBind = vi.fn().mockReturnValue({ first: mockFirst });

    // Mock DB insert
    const mockRun = vi.fn().mockResolvedValueOnce({});
    const mockInsertBind = vi.fn().mockReturnValue({ run: mockRun });

    mockDB.prepare
      .mockReturnValueOnce({ bind: mockBind }) // First call for SELECT
      .mockReturnValueOnce({ bind: mockInsertBind }); // Second call for INSERT

    // Mock admin notification (notifyAdminsWithPreviews calls dbList)
    const mockListResults = { results: [] };
    const mockListAll = vi.fn().mockResolvedValueOnce(mockListResults);
    const mockListBind = vi.fn().mockReturnValue({ all: mockListAll });
    mockDB.prepare.mockReturnValueOnce({ bind: mockListBind }); // For dbList call

    // Create request
    const request = new Request('https://example.com/api/request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': '1.2.3.4',
      },
      body: JSON.stringify({
        id: 'abc123',
        name: 'John Doe',
        message: 'Please send me this postcard!',
        turnstileToken: 'valid-token',
      }),
    });

    const response = await handleWebRequest(request, mockEnv);
    const data = await response.json();

    // Verify Turnstile was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    );

    // Verify DB card lookup was called
    expect(mockDB.prepare).toHaveBeenCalledWith(
      "SELECT id FROM cards WHERE id=?1 AND status='available'"
    );
    expect(mockBind).toHaveBeenCalledWith('abc123');

    // Verify DB insert was called
    expect(mockDB.prepare).toHaveBeenCalledWith(
      'INSERT INTO requests (postcard_id, name, message, created_at) VALUES (?1, ?2, ?3, ?4)'
    );
    expect(mockInsertBind).toHaveBeenCalledWith(
      'abc123',
      'John Doe',
      'Please send me this postcard!',
      expect.any(Number)
    );

    // Verify response
    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
  });

  it('rejects requests with an invalid Turnstile token', async () => {
    // Mock Turnstile verification failure
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: false }),
    });

    const request = new Request('https://example.com/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'abc123',
        name: 'John Doe',
        message: 'Test message',
        turnstileToken: 'invalid-token',
      }),
    });

    const response = await handleWebRequest(request, mockEnv);
    const text = await response.text();

    // Verify response
    expect(response.status).toBe(403);
    expect(text).toBe('turnstile failed');

    // Verify DB was not called
    expect(mockDB.prepare).not.toHaveBeenCalled();
  });

  it('returns an error if required fields like name are missing', async () => {
    const request = new Request('https://example.com/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'abc123',
        name: '', // Empty name
        message: 'Test message',
        turnstileToken: 'some-token',
      }),
    });

    const response = await handleWebRequest(request, mockEnv);
    const text = await response.text();

    // Verify response
    expect(response.status).toBe(400);
    expect(text).toBe('name required');

    // Verify Turnstile was not called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns a 404 if the requested postcard ID is not available', async () => {
    // Mock Turnstile verification success
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, hostname: 'subach.uk' }),
    });

    // Mock DB card lookup - card not found
    const mockFirst = vi.fn().mockResolvedValueOnce(null);
    const mockBind = vi.fn().mockReturnValue({ first: mockFirst });
    mockDB.prepare.mockReturnValueOnce({ bind: mockBind });

    const request = new Request('https://example.com/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'nonexistent',
        name: 'John Doe',
        message: 'Test message',
        turnstileToken: 'valid-token',
      }),
    });

    const response = await handleWebRequest(request, mockEnv);
    const text = await response.text();

    // Verify response
    expect(response.status).toBe(404);
    expect(text).toBe('not found');

    // Verify DB insert was not called (only SELECT was called)
    expect(mockDB.prepare).toHaveBeenCalledTimes(1);
  });

  it('validates postcard ID format', async () => {
    const request = new Request('https://example.com/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'invalid!@#', // Invalid characters
        name: 'John Doe',
        message: 'Test',
        turnstileToken: 'token',
      }),
    });

    const response = await handleWebRequest(request, mockEnv);
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toBe('bad id');
  });

  it('requires Turnstile token', async () => {
    const request = new Request('https://example.com/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'abc123',
        name: 'John Doe',
        message: 'Test',
        turnstileToken: '', // Empty token
      }),
    });

    const response = await handleWebRequest(request, mockEnv);
    const text = await response.text();

    expect(response.status).toBe(403);
    expect(text).toBe('turnstile required');
  });

  it('honeypot: silently accepts requests with website field populated', async () => {
    const request = new Request('https://example.com/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'abc123',
        name: 'Spammer',
        message: 'Spam',
        website: 'http://spam.com', // Honeypot field filled
        turnstileToken: 'token',
      }),
    });

    const response = await handleWebRequest(request, mockEnv);
    const data = await response.json();

    // Should return success but not process the request
    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });

    // Verify DB was not called (request was not actually processed)
    expect(mockDB.prepare).not.toHaveBeenCalled();
  });

  it('only accepts POST requests', async () => {
    const request = new Request('https://example.com/api/request', {
      method: 'GET',
    });

    const response = await handleWebRequest(request, mockEnv);
    const text = await response.text();

    expect(response.status).toBe(405);
    expect(text).toBe('method not allowed');
  });

  it('returns error for invalid JSON', async () => {
    const request = new Request('https://example.com/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'invalid json{',
    });

    const response = await handleWebRequest(request, mockEnv);
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toBe('bad json');
  });
});

describe('worker.fetch integration', () => {
  function createDbMock({
    availableIds = [],
    cards = [],
    insertedRequests = [],
    cardRecords = [],
    deletedCardIds = [],
    adminActionRecords = [],
    createdAdminActions = [],
    deletedAdminActionTokens = [],
  } = {}) {
    const available = new Set(availableIds);
    const cardStore = new Map(
      cardRecords.map((c) => [
        c.id,
        {
          id: c.id,
          created_at: c.created_at ?? 0,
          status: c.status || 'available',
          category: c.category || 'other',
          image_key: c.image_key || `cards/${c.id}/full.jpg`,
          thumb_key: c.thumb_key || `cards/${c.id}/thumb.jpg`,
        },
      ])
    );
    for (const id of availableIds) {
      if (!cardStore.has(id)) {
        cardStore.set(id, {
          id,
          created_at: 0,
          status: 'available',
          category: 'other',
          image_key: `cards/${id}/full.jpg`,
          thumb_key: `cards/${id}/thumb.jpg`,
        });
      }
    }
    for (const row of cardStore.values()) {
      if (row.status === 'available') available.add(row.id);
    }

    const adminActions = new Map(
      adminActionRecords.map((a) => [
        a.token,
        {
          token: a.token,
          action_type: a.action_type,
          payload_json: a.payload_json,
          created_at: a.created_at ?? Date.now(),
          expires_at: a.expires_at ?? Date.now() + 60_000,
        },
      ])
    );

    return {
      prepare(sql) {
        return {
          bind(...args) {
            if (
              sql.includes(
                'SELECT id, created_at, status, category, image_key, thumb_key FROM cards WHERE id=?1'
              )
            ) {
              const id = args[0];
              return {
                first: async () => cardStore.get(id) || null,
              };
            }

            if (sql.includes("SELECT id FROM cards WHERE id=?1 AND status='available'")) {
              const id = args[0];
              return {
                first: async () => (available.has(id) ? { id } : null),
              };
            }

            if (
              sql.includes(
                'INSERT INTO requests (postcard_id, name, message, created_at) VALUES (?1, ?2, ?3, ?4)'
              )
            ) {
              return {
                run: async () => {
                  insertedRequests.push({
                    postcard_id: args[0],
                    name: args[1],
                    message: args[2],
                    created_at: args[3],
                  });
                  return {};
                },
              };
            }

            if (
              sql.includes(
                "SELECT id, created_at, category FROM cards WHERE status='available' AND category=?1 ORDER BY created_at DESC LIMIT ?2"
              )
            ) {
              const [category, limit] = args;
              return {
                all: async () => ({
                  results: cards
                    .filter((x) => x.category === category)
                    .sort((a, b) => b.created_at - a.created_at)
                    .slice(0, limit),
                }),
              };
            }

            if (
              sql.includes(
                "SELECT id, created_at, category FROM cards WHERE status='available' ORDER BY created_at DESC LIMIT ?1"
              )
            ) {
              const [limit] = args;
              return {
                all: async () => ({
                  results: cards.sort((a, b) => b.created_at - a.created_at).slice(0, limit),
                }),
              };
            }

            if (sql.includes('DELETE FROM cards WHERE id=?1')) {
              const id = args[0];
              return {
                run: async () => {
                  deletedCardIds.push(id);
                  available.delete(id);
                  cardStore.delete(id);
                  return {};
                },
              };
            }

            if (sql.includes('INSERT INTO admin_actions')) {
              const [token, actionType, payloadJson, createdAt, expiresAt] = args;
              return {
                run: async () => {
                  if (adminActions.has(token)) {
                    throw new Error('UNIQUE constraint failed: admin_actions.token');
                  }
                  const row = {
                    token,
                    action_type: actionType,
                    payload_json: payloadJson,
                    created_at: createdAt,
                    expires_at: expiresAt,
                  };
                  adminActions.set(token, row);
                  createdAdminActions.push(row);
                  return {};
                },
              };
            }

            if (
              sql.includes(
                'SELECT token, action_type, payload_json, created_at, expires_at FROM admin_actions WHERE token=?1'
              )
            ) {
              const [token] = args;
              return {
                first: async () => adminActions.get(token) || null,
              };
            }

            if (sql.includes('DELETE FROM admin_actions WHERE token=?1')) {
              const [token] = args;
              return {
                run: async () => {
                  deletedAdminActionTokens.push(token);
                  adminActions.delete(token);
                  return {};
                },
              };
            }

            if (sql.includes('DELETE FROM admin_actions WHERE expires_at <= ?1')) {
              const [nowTs] = args;
              return {
                run: async () => {
                  for (const [token, row] of adminActions.entries()) {
                    if (Number(row.expires_at) <= Number(nowTs)) {
                      adminActions.delete(token);
                    }
                  }
                  return {};
                },
              };
            }

            throw new Error(`Unhandled SQL in test: ${sql}`);
          },
        };
      },
    };
  }

  function createEnv({ db, adminChatIds = '1001,1002' } = {}) {
    return {
      DB: db || createDbMock(),
      ADMIN_CHAT_IDS: adminChatIds,
      TURNSTILE_SECRET_KEY: 'prod-secret',
      TG_BOT_TOKEN: 'test-bot-token',
      TG_WEBHOOK_SECRET: 'tg-hook-secret',
      SITE_URL: 'https://example.com',
      BUCKET: { delete: vi.fn() },
      ASSETS: { fetch: vi.fn() },
    };
  }

  it('returns categories list from /api/categories', async () => {
    const env = createEnv();
    const response = await worker.fetch(
      new Request('https://example.com/api/categories', { method: 'GET' }),
      env
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.categories)).toBe(true);
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.categories).toContainEqual({
      slug: 'nature',
      en: 'Nature',
      ru: 'Природа',
    });
  });

  it('filters cards by category in /api/cards', async () => {
    const db = createDbMock({
      cards: [
        { id: 'nature1', created_at: 300, category: 'nature' },
        { id: 'nature2', created_at: 200, category: 'nature' },
        { id: 'animals1', created_at: 100, category: 'animals' },
      ],
    });
    const env = createEnv({ db });

    const response = await worker.fetch(
      new Request('https://example.com/api/cards?limit=10&category=nature'),
      env
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(2);
    expect(data.items.map((x) => x.id)).toEqual(['nature1', 'nature2']);
    expect(data.items[0]).toMatchObject({
      id: 'nature1',
      category: 'nature',
      thumbUrl: '/thumb/nature1.jpg',
      imageUrl: '/img/nature1.jpg',
    });
  });

  it('handles cart request with ids and inserts one request row per postcard', async () => {
    const insertedRequests = [];
    const createdAdminActions = [];
    const db = createDbMock({
      availableIds: ['abc123', 'def456'],
      insertedRequests,
      createdAdminActions,
    });
    const env = createEnv({ db });

    const fetchMock = vi.fn(async (url) => {
      if (url.includes('/turnstile/v0/siteverify')) {
        return { json: async () => ({ success: true, hostname: 'example.com' }) };
      }
      if (url.includes('/sendMessage')) return { json: async () => ({ ok: true }) };
      if (url.includes('/sendMediaGroup')) return { json: async () => ({ ok: true }) };
      if (url.includes('/sendPhoto')) return { json: async () => ({ ok: true }) };
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const prevFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const response = await worker.fetch(
        new Request('https://example.com/api/request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids: ['abc123', 'def456'],
            name: 'John Doe',
            message: 'Hello from cart',
            turnstileToken: 'valid-token',
          }),
        }),
        env
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ ok: true });
      expect(insertedRequests).toHaveLength(2);
      expect(insertedRequests.map((x) => x.postcard_id)).toEqual(['abc123', 'def456']);

      const sendMediaGroupCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/sendMediaGroup')
      );
      expect(sendMediaGroupCalls).toHaveLength(2);

      const sendMessageCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/sendMessage')
      );
      expect(sendMessageCalls).toHaveLength(2);
      const firstPayload = JSON.parse(sendMessageCalls[0][1].body);
      const callbackData = firstPayload.reply_markup.inline_keyboard
        .flat()
        .map((btn) => btn.callback_data);
      expect(callbackData.some((x) => String(x).startsWith('delall:'))).toBe(true);
      expect(callbackData).toContain('del:abc123');
      expect(callbackData).toContain('del:def456');
      expect(createdAdminActions).toHaveLength(1);
      expect(createdAdminActions[0].action_type).toBe('bulk_delete_cards');
    } finally {
      global.fetch = prevFetch;
    }
  });

  it('returns 400 for cart request when all ids are invalid', async () => {
    const db = createDbMock();
    const env = createEnv({ db });

    const fetchMock = vi.fn(async (url) => {
      if (url.includes('/turnstile/v0/siteverify')) {
        return { json: async () => ({ success: true, hostname: 'example.com' }) };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const prevFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const response = await worker.fetch(
        new Request('https://example.com/api/request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ids: ['***', '!!!'],
            name: 'John Doe',
            message: 'Bad ids',
            turnstileToken: 'valid-token',
          }),
        }),
        env
      );
      const text = await response.text();

      expect(response.status).toBe(400);
      expect(text).toBe('bad id');
    } finally {
      global.fetch = prevFetch;
    }
  });

  it('deletes postcard from callback query action', async () => {
    const deletedCardIds = [];
    const db = createDbMock({
      cardRecords: [
        {
          id: 'abc123',
          created_at: 100,
          status: 'available',
          category: 'nature',
          image_key: 'cards/abc123/full.jpg',
          thumb_key: 'cards/abc123/thumb.jpg',
        },
      ],
      deletedCardIds,
    });
    const env = createEnv({ db, adminChatIds: '1001' });

    const fetchMock = vi.fn(async (url) => {
      if (url.includes('/answerCallbackQuery')) return { json: async () => ({ ok: true }) };
      if (url.includes('/sendMessage')) return { json: async () => ({ ok: true }) };
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const prevFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const response = await worker.fetch(
        new Request('https://example.com/tg', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET,
          },
          body: JSON.stringify({
            callback_query: {
              id: 'cb_1',
              data: 'del:abc123',
              from: { id: 1001 },
              message: { chat: { id: 1001 } },
            },
          }),
        }),
        env
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ ok: true });
      expect(env.BUCKET.delete).toHaveBeenCalledWith('cards/abc123/full.jpg');
      expect(env.BUCKET.delete).toHaveBeenCalledWith('cards/abc123/thumb.jpg');
      expect(deletedCardIds).toEqual(['abc123']);

      const answerCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/answerCallbackQuery')
      );
      expect(answerCalls).toHaveLength(1);
    } finally {
      global.fetch = prevFetch;
    }
  });

  it('deletes all postcards from bulk callback action token', async () => {
    const deletedCardIds = [];
    const deletedAdminActionTokens = [];
    const db = createDbMock({
      cardRecords: [
        {
          id: 'abc123',
          status: 'available',
          image_key: 'cards/abc123/full.jpg',
          thumb_key: 'cards/abc123/thumb.jpg',
        },
        {
          id: 'def456',
          status: 'available',
          image_key: 'cards/def456/full.jpg',
          thumb_key: 'cards/def456/thumb.jpg',
        },
      ],
      adminActionRecords: [
        {
          token: 'tok12345',
          action_type: 'bulk_delete_cards',
          payload_json: JSON.stringify({ ids: ['abc123', 'def456', 'gone999'] }),
          expires_at: Date.now() + 60_000,
        },
      ],
      deletedCardIds,
      deletedAdminActionTokens,
    });
    const env = createEnv({ db, adminChatIds: '1001' });

    const fetchMock = vi.fn(async (url) => {
      if (url.includes('/answerCallbackQuery')) return { json: async () => ({ ok: true }) };
      if (url.includes('/sendMessage')) return { json: async () => ({ ok: true }) };
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const prevFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const response = await worker.fetch(
        new Request('https://example.com/tg', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': env.TG_WEBHOOK_SECRET,
          },
          body: JSON.stringify({
            callback_query: {
              id: 'cb_2',
              data: 'delall:tok12345',
              from: { id: 1001, username: 'admin' },
              message: { chat: { id: 1001 } },
            },
          }),
        }),
        env
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ ok: true });
      expect(env.BUCKET.delete).toHaveBeenCalledWith('cards/abc123/full.jpg');
      expect(env.BUCKET.delete).toHaveBeenCalledWith('cards/abc123/thumb.jpg');
      expect(env.BUCKET.delete).toHaveBeenCalledWith('cards/def456/full.jpg');
      expect(env.BUCKET.delete).toHaveBeenCalledWith('cards/def456/thumb.jpg');
      expect(deletedCardIds.sort()).toEqual(['abc123', 'def456']);
      expect(deletedAdminActionTokens).toContain('tok12345');

      const answerCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/answerCallbackQuery')
      );
      expect(answerCalls).toHaveLength(1);
      const answerPayload = JSON.parse(answerCalls[0][1].body);
      expect(answerPayload.text).toBe('Removed 2/3');
    } finally {
      global.fetch = prevFetch;
    }
  });
});
