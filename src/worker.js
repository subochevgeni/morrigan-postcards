// src/worker.js

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const text = (s, status = 200) => new Response(s, { status });

// Категории открыток (как у посткроссеров): slug -> { en, ru }
const CATEGORIES = {
  nature: { en: 'Nature', ru: 'Природа' },
  animals: { en: 'Animals', ru: 'Животные' },
  architecture: { en: 'Architecture', ru: 'Архитектура' },
  transport: { en: 'Transport', ru: 'Транспорт' },
  people: { en: 'People', ru: 'Люди' },
  travel: { en: 'Travel', ru: 'Путешествия' },
  art: { en: 'Art', ru: 'Искусство' },
  other: { en: 'Other', ru: 'Разное' },
};

const CATEGORY_SLUGS = Object.keys(CATEGORIES);

function normalizeCategory(caption) {
  if (!caption || typeof caption !== 'string') return 'other';
  const s = caption.trim().toLowerCase();
  if (!s) return 'other';
  const byEn = Object.entries(CATEGORIES).find(([, { en }]) => en.toLowerCase() === s);
  if (byEn) return byEn[0];
  const byRu = Object.entries(CATEGORIES).find(([, { ru }]) => ru.toLowerCase() === s);
  if (byRu) return byRu[0];
  if (CATEGORY_SLUGS.includes(s)) return s;
  return 'other';
}

function makeId(len = 6) {
  const alphabet = '23456789abcdefghijkmnpqrstuvwxyz';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function getAdminList(env) {
  const raw = (env.ADMIN_CHAT_IDS || String(env.ADMIN_CHAT_ID || '')).trim();
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function tgApi(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!data?.ok) console.log('tgApi error', method, data);
  return data;
}

async function tgSend(env, chatId, msg, replyMarkup = null) {
  const payload = { chat_id: chatId, text: msg };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await tgApi(env, 'sendMessage', payload);
}

async function tgSendPhoto(env, chatId, photoUrl, caption) {
  // Telegram умеет тянуть фото по HTTP URL. :contentReference[oaicite:5]{index=5}
  await tgApi(env, 'sendPhoto', { chat_id: chatId, photo: photoUrl, caption });
}

async function tgSendMediaGroup(env, chatId, media) {
  // Метод sendMediaGroup существует в Bot API (альбомы). :contentReference[oaicite:6]{index=6}
  return tgApi(env, 'sendMediaGroup', { chat_id: chatId, media });
}

async function tgGetFileUrl(env, fileId) {
  const data = await tgApi(env, 'getFile', { file_id: fileId });
  const filePath = data?.result?.file_path;
  if (!filePath) throw new Error('getFile failed');
  return `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`;
}

async function tgGetWebhookInfo(env) {
  return tgApi(env, 'getWebhookInfo', {});
}

async function tgSetWebhook(env) {
  const payload = {
    url: `${getSiteUrl(env)}/tg`,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  };
  const secret = String(env.TG_WEBHOOK_SECRET || '').trim();
  if (secret) payload.secret_token = secret;
  return tgApi(env, 'setWebhook', payload);
}

function formatWebhookInfo(info) {
  if (!info?.ok || !info.result) return '❌ Could not fetch webhook info from Telegram.';
  const r = info.result;
  const lines = [
    '🔌 Webhook info',
    `URL: ${r.url || '(not set)'}`,
    `Pending updates: ${Number(r.pending_update_count || 0)}`,
    `Max connections: ${Number(r.max_connections || 0)}`,
  ];
  if (r.last_error_message) lines.push(`Last error: ${r.last_error_message}`);
  if (r.last_error_date) {
    lines.push(`Last error date: ${new Date(r.last_error_date * 1000).toISOString()}`);
  }
  return lines.join('\n');
}

function adminKeyboard() {
  return {
    keyboard: [
      [{ text: '📊 Stats' }, { text: '🆕 Last' }],
      [{ text: '🗂️ List 20' }, { text: '🕘 Recent' }],
      [{ text: '📈 Analytics' }, { text: '🆔 My ID' }],
      [{ text: '🔌 Webhook' }],
      [{ text: '🗑 Delete by ID' }, { text: '❓ Help' }],
    ],
    resize_keyboard: true,
  };
}

function adminHelpText() {
  const catList = CATEGORY_SLUGS.join(', ');
  return (
    '📌 Admin panel\n' +
    '• Send postcard as Photo to add it\n' +
    '• Optional category in caption: ' + catList + '\n' +
    '• For website requests, use 🗑 buttons under request message (single or Delete all)\n\n' +
    'Commands:\n' +
    '/help — this menu\n' +
    '/myid — show chat_id\n' +
    '/stats — how many available\n' +
    '/last — last added\n' +
    '/list [n] — last n IDs (1..200)\n' +
    '/recent [n] — recent admin events\n' +
    '/analytics [days] — aggregated counters\n' +
    '/webhookinfo — Telegram webhook diagnostics\n' +
    '/setwebhook — reset webhook with callback_query support\n' +
    '/delete <id> — delete postcard'
  );
}

function normalizeAdminText(text) {
  const t = String(text || '').trim();
  if (t === '📊 Stats') return '/stats';
  if (t === '🆕 Last') return '/last';
  if (t === '🗂️ List 20') return '/list 20';
  if (t === '🕘 Recent') return '/recent 15';
  if (t === '📈 Analytics') return '/analytics 7';
  if (t === '🆔 My ID') return '/myid';
  if (t === '🔌 Webhook') return '/webhookinfo';
  if (t === '🗑 Delete by ID') return '/delete';
  if (t === '❓ Help') return '/help';
  return t;
}

function cleanPostcardIds(ids, limit = 10) {
  return Array.from(
    new Set(
      ids
        .map((x) => String(x || '').trim().toLowerCase())
        .filter((x) => /^[0-9a-z]{4,12}$/i.test(x))
    )
  ).slice(0, limit);
}

function buildDeleteInlineKeyboard(ids, bulkToken = null) {
  const clean = cleanPostcardIds(ids, 10);
  if (!clean.length) return null;

  const rows = [];
  if (bulkToken && clean.length > 1) {
    rows.push([
      {
        text: `🗑 Delete all (${clean.length})`,
        callback_data: `delall:${bulkToken}`,
      },
    ]);
  }

  for (let i = 0; i < clean.length; i += 2) {
    rows.push(
      clean.slice(i, i + 2).map((id) => ({
        text: `🗑 ${id}`,
        callback_data: `del:${id}`,
      }))
    );
  }
  return { inline_keyboard: rows };
}

const ADMIN_ACTION_TTL_MS = 1000 * 60 * 60 * 24;
const CARD_RESERVE_MS = 1000 * 60 * 15;
const REQUEST_DEDUP_MS = 1000 * 60 * 20;

async function dbCreateAdminAction(env, { token, actionType, payloadJson, createdAt, expiresAt }) {
  await env.DB.prepare(
    'INSERT INTO admin_actions (token, action_type, payload_json, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)'
  )
    .bind(token, actionType, payloadJson, createdAt, expiresAt)
    .run();
}

async function dbGetAdminAction(env, token) {
  const row = await env.DB.prepare(
    'SELECT token, action_type, payload_json, created_at, expires_at FROM admin_actions WHERE token=?1'
  )
    .bind(token)
    .first();
  return row || null;
}

async function dbDeleteAdminAction(env, token) {
  await env.DB.prepare('DELETE FROM admin_actions WHERE token=?1').bind(token).run();
}

async function dbDeleteExpiredAdminActions(env, nowTs) {
  await env.DB.prepare('DELETE FROM admin_actions WHERE expires_at <= ?1')
    .bind(nowTs)
    .run();
}

async function createBulkDeleteAction(env, ids) {
  const clean = cleanPostcardIds(ids, 10);
  if (clean.length < 2) return null;

  const now = Date.now();
  const expiresAt = now + ADMIN_ACTION_TTL_MS;
  const payloadJson = JSON.stringify({ ids: clean });

  try {
    await dbDeleteExpiredAdminActions(env, now);
  } catch (e) {
    console.log('admin action cleanup failed', e);
  }

  for (let i = 0; i < 5; i++) {
    const token = makeId(8);
    try {
      await dbCreateAdminAction(env, {
        token,
        actionType: 'bulk_delete_cards',
        payloadJson,
        createdAt: now,
        expiresAt,
      });
      return token;
    } catch (e) {
      const m = String(e?.message || '');
      if (m.toLowerCase().includes('unique')) continue;
      console.log('admin action create failed', e);
      return null;
    }
  }

  return null;
}

async function deleteCardIfExists(env, id, meta = {}) {
  const card = await dbGetCard(env, id);
  if (!card) return { id, deleted: false };

  await env.BUCKET.delete(card.image_key);
  await env.BUCKET.delete(card.thumb_key);
  await dbDeleteCard(env, id);
  await addAdminEvent(env, {
    action: 'delete_card',
    ids: [id],
    adminChatId: meta.adminChatId || '',
    details: meta.details || null,
  });
  await trackAnalytics(env, 'card_deleted');
  return { id, deleted: true };
}

function parseBulkDeleteIds(actionRow) {
  if (!actionRow || actionRow.action_type !== 'bulk_delete_cards') return [];
  let parsed;
  try {
    parsed = JSON.parse(actionRow.payload_json || '{}');
  } catch {
    parsed = {};
  }
  return cleanPostcardIds(Array.isArray(parsed?.ids) ? parsed.ids : [], 10);
}

function isActionExpired(actionRow) {
  return Number(actionRow?.expires_at || 0) <= Date.now();
}

function summarizeBulkDelete(results) {
  const removed = results.filter((x) => x.deleted).map((x) => x.id);
  const missing = results.filter((x) => !x.deleted).map((x) => x.id);

  let out = `🗑 Bulk delete done: removed ${removed.length}/${results.length}`;
  if (removed.length) out += `\nRemoved: ${removed.join(', ')}`;
  if (missing.length) out += `\nAlready missing: ${missing.join(', ')}`;
  return out;
}

function callbackNoticeText(prefix, callback) {
  const user = callback?.from?.username ? `@${callback.from.username}` : '(no username)';
  return `${prefix} by ${user}`;
}

function toUtcDateKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

async function trackAnalytics(env, eventName, inc = 1, ts = Date.now()) {
  const safeName = String(eventName || '').trim().slice(0, 64);
  if (!safeName || !Number.isFinite(inc) || inc <= 0) return;
  try {
    await env.DB.prepare(
      `INSERT INTO analytics_daily (event_date, event_name, cnt)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(event_date, event_name)
       DO UPDATE SET cnt = cnt + excluded.cnt`
    )
      .bind(toUtcDateKey(ts), safeName, inc)
      .run();
  } catch (e) {
    console.log('analytics write skipped', e);
  }
}

async function addAdminEvent(env, { action, ids = [], adminChatId = '', details = null, ts = Date.now() }) {
  const idsJson = JSON.stringify(cleanPostcardIds(Array.isArray(ids) ? ids : [ids], 20));
  const detailsJson = details ? JSON.stringify(details) : null;
  try {
    await env.DB.prepare(
      'INSERT INTO admin_events (action, ids_json, admin_chat_id, details_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
    )
      .bind(String(action || '').slice(0, 64), idsJson, String(adminChatId || ''), detailsJson, ts)
      .run();
  } catch (e) {
    console.log('admin event write skipped', e);
  }
}

async function listAdminEvents(env, limit = 15) {
  const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 50);
  try {
    const { results } = await env.DB.prepare(
      'SELECT action, ids_json, admin_chat_id, details_json, created_at FROM admin_events ORDER BY created_at DESC LIMIT ?1'
    )
      .bind(safeLimit)
      .all();
    return results || [];
  } catch (e) {
    console.log('admin events read skipped', e);
    return [];
  }
}

function formatAdminEvents(events) {
  if (!events.length) return 'No recent admin events.';
  const lines = ['🕘 Recent admin events'];
  for (const ev of events) {
    let ids = [];
    try {
      ids = JSON.parse(ev.ids_json || '[]');
    } catch {
      ids = [];
    }
    lines.push(
      `${REQUEST_VISUAL_DIVIDER}\n` +
        `${formatRequestTimestamp(ev.created_at)}\n` +
        `Action: ${ev.action}\n` +
        `IDs: ${ids.length ? ids.join(', ') : '—'}\n` +
        `Admin: ${ev.admin_chat_id || '—'}`
    );
  }
  return lines.join('\n');
}

async function readAnalytics(env, days = 7) {
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 60);
  const from = toUtcDateKey(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  try {
    const { results } = await env.DB.prepare(
      `SELECT event_name, SUM(cnt) AS total
       FROM analytics_daily
       WHERE event_date >= ?1
       GROUP BY event_name
       ORDER BY total DESC`
    )
      .bind(from)
      .all();
    return results || [];
  } catch (e) {
    console.log('analytics read skipped', e);
    return [];
  }
}

function formatAnalytics(rows, days) {
  if (!rows.length) return `📈 Analytics (${days}d)\nNo data yet.`;
  return `📈 Analytics (${days}d)\n` + rows.map((r) => `• ${r.event_name}: ${r.total}`).join('\n');
}

async function releaseExpiredReservations(env, now = Date.now()) {
  try {
    await env.DB.prepare(
      "UPDATE cards SET status='available', pending_until=NULL WHERE status='pending' AND pending_until IS NOT NULL AND pending_until<=?1"
    )
      .bind(now)
      .run();
  } catch (e) {
    console.log('reservation cleanup skipped', e);
  }
}

async function reserveCards(env, ids, now = Date.now()) {
  const clean = cleanPostcardIds(ids, MAX_CART_IDS);
  if (!clean.length) return;
  const until = now + CARD_RESERVE_MS;
  try {
    for (const id of clean) {
      await env.DB.prepare(
        "UPDATE cards SET status='pending', pending_until=?2 WHERE id=?1 AND status='available'"
      )
        .bind(id, until)
        .run();
    }
    await trackAnalytics(env, 'cards_reserved', clean.length, now);
  } catch (e) {
    console.log('reserve cards skipped', e);
  }
}

async function isDuplicateRequest(env, name, ids, now = Date.now()) {
  const clean = cleanPostcardIds(ids, MAX_CART_IDS);
  if (!name || !clean.length) return false;
  const cutoff = now - REQUEST_DEDUP_MS;
  try {
    const { results } = await env.DB.prepare(
      `SELECT created_at, group_concat(postcard_id) AS ids_csv
       FROM requests
       WHERE name=?1 AND created_at>=?2
       GROUP BY created_at
       ORDER BY created_at DESC
       LIMIT 30`
    )
      .bind(name, cutoff)
      .all();

    for (const row of results || []) {
      const got = Array.from(
        new Set(String(row.ids_csv || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))
      ).sort();
      const want = [...clean].sort();
      if (got.length === want.length && got.every((x, i) => x === want[i])) return true;
    }
  } catch (e) {
    console.log('duplicate check skipped', e);
  }
  return false;
}

async function dbGetCard(env, id) {
  const row = await env.DB.prepare(
    'SELECT id, created_at, status, category, image_key, thumb_key FROM cards WHERE id=?1'
  )
    .bind(id)
    .first();
  return row || null;
}

async function dbInsertCard(env, { id, createdAt, category, imageKey, thumbKey }) {
  const cat = CATEGORY_SLUGS.includes(category) ? category : 'other';
  await env.DB.prepare(
    "INSERT INTO cards (id, created_at, status, category, image_key, thumb_key) VALUES (?1, ?2, 'available', ?3, ?4, ?5)"
  )
    .bind(id, createdAt, cat, imageKey, thumbKey)
    .run();
}

async function dbDeleteCard(env, id) {
  await env.DB.prepare('DELETE FROM cards WHERE id=?1').bind(id).run();
}

async function dbStats(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM cards WHERE status='available'"
  ).first();
  return Number(row?.cnt || 0);
}

async function dbLast(env) {
  return (
    (await env.DB.prepare(
      "SELECT id, created_at FROM cards WHERE status='available' ORDER BY created_at DESC LIMIT 1"
    ).first()) || null
  );
}

async function dbList(env, limit) {
  const { results } = await env.DB.prepare(
    "SELECT id FROM cards WHERE status='available' ORDER BY created_at DESC LIMIT ?1"
  )
    .bind(limit)
    .all();
  return (results || []).map((r) => r.id);
}

function getSiteUrl(env) {
  return String(env.SITE_URL || 'https://subach.uk').replace(/\/$/, '');
}

const REQUEST_VISUAL_DIVIDER = '━━━━━━━━━━━━━━━━━━━━';

function formatRequestTimestamp(ts) {
  const d = new Date(Number(ts || Date.now()));
  if (Number.isNaN(d.getTime())) return String(ts || '');
  return d.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

function buildAdminRequestText({ postcardIds, name, message, siteUrl, createdAt }) {
  const ids = cleanPostcardIds(Array.isArray(postcardIds) ? postcardIds : [postcardIds], 20);
  const isMulti = ids.length > 1;
  const idsBlock = isMulti
    ? `📮 IDs (${ids.length}):\n${ids.map((id) => `• ${id}`).join('\n')}`
    : `📮 ID: ${ids[0] || '—'}`;
  const siteLink = isMulti ? siteUrl : `${siteUrl}/#${ids[0] || ''}`;

  return (
    `🆕 WEBSITE REQUEST${isMulti ? ' · MULTI' : ''}\n` +
    `${REQUEST_VISUAL_DIVIDER}\n` +
    `${idsBlock}\n` +
    `👤 Name: ${name}\n` +
    `💬 Message: ${message || '—'}\n` +
    `🕒 ${formatRequestTimestamp(createdAt)}\n` +
    `🌐 ${siteLink}`
  );
}

async function notifyAdminsWithRequestCard(env, postcardId, requestText, imageUrl) {
  const url = imageUrl || `${getSiteUrl(env)}/thumb/${postcardId}.jpg`;
  const deleteKeyboard = buildDeleteInlineKeyboard([postcardId]);
  for (const adminId of getAdminList(env)) {
    const textWithActions = deleteKeyboard
      ? requestText +
        `\n${REQUEST_VISUAL_DIVIDER}\n` +
        '🛠 Quick actions: tap button below to remove this card from gallery.'
      : requestText;
    await tgSend(env, adminId, textWithActions, deleteKeyboard);
    await tgSendPhoto(env, adminId, url, `ID: ${postcardId}`);
  }
}

const MAX_CART_IDS = 20;

async function notifyAdminsWithRequestCards(env, postcardIds, requestText) {
  const siteUrl = getSiteUrl(env);
  const ids = cleanPostcardIds(postcardIds, 10);
  const bulkToken = await createBulkDeleteAction(env, ids);
  const deleteKeyboard = buildDeleteInlineKeyboard(ids, bulkToken);
  const media = ids.map((id, idx) => ({
    type: 'photo',
    media: `${siteUrl}/thumb/${id}.jpg`,
    caption: idx === 0 ? requestText : `ID: ${id}`,
  }));

  for (const adminId of getAdminList(env)) {
    const textWithActions = deleteKeyboard
      ? requestText +
        `\n${REQUEST_VISUAL_DIVIDER}\n` +
        '🛠 Quick actions: tap ID to remove one card, or Delete all to remove the whole set.'
      : requestText;
    await tgSend(env, adminId, textWithActions, deleteKeyboard);
    if (media.length > 0) {
      const res = await tgSendMediaGroup(env, adminId, media);
      if (!res?.ok) {
        for (const id of ids) {
          await tgSendPhoto(env, adminId, `${siteUrl}/thumb/${id}.jpg`, `ID: ${id}`);
        }
      }
    }
  }
}

const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

async function verifyTurnstileWithSecret(request, token, secret) {
  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);

  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.set('remoteip', ip);

  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  return r.json().catch(() => null);
}

async function verifyTurnstile(request, env, token) {
  const secret = env.TURNSTILE_SECRET_KEY || TURNSTILE_TEST_SECRET;
  const isTestKey = secret === TURNSTILE_TEST_SECRET;

  let data = await verifyTurnstileWithSecret(request, token, secret);
  let usedTestSecret = isTestKey;

  // Если на бэкенде прод-ключ, а токен с тестового виджета — пробуем тестовый секрет (для локальной разработки).
  if (!data?.success && !isTestKey && env.TURNSTILE_SECRET_KEY) {
    data = await verifyTurnstileWithSecret(request, token, TURNSTILE_TEST_SECRET);
    if (data?.success) usedTestSecret = true;
  }

  if (!data?.success) return { ok: false, data };

  // При тестовом ключе hostname может быть localhost — не проверяем.
  if (!usedTestSecret && data.hostname) {
    const requestHost = new URL(request.url).hostname;
    const h = String(data.hostname);
    const allowed =
      h.endsWith('subach.uk') ||
      h.includes('subach.uk') ||
      h === requestHost;
    if (!allowed) {
      return { ok: false, data: { ...data, reason: 'bad-hostname' } };
    }
  }

  return { ok: true, data };
}

async function handleWebRequest(request, env) {
  if (request.method !== 'POST') return text('method not allowed', 405);
  await releaseExpiredReservations(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return text('bad json', 400);
  }

  // Honeypot
  if (String(body?.website || '').trim()) return json({ ok: true });

  const name = String(body?.name || '')
    .trim()
    .slice(0, 80);
  const message = String(body?.message || '')
    .trim()
    .slice(0, 600);
  const token = String(body?.turnstileToken || '').trim();

  if (!name) return text('name required', 400);
  if (!token) return text('turnstile required', 403);

  const ts = await verifyTurnstile(request, env, token);
  if (!ts.ok) return text('turnstile failed', 403);

  const siteUrl = getSiteUrl(env);
  const idsParam = body?.ids;
  const singleId = body?.id;

  if (Array.isArray(idsParam) && idsParam.length > 0) {
    const postcardIds = idsParam
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x) => /^[0-9a-z]{4,12}$/i.test(x))
      .slice(0, MAX_CART_IDS);
    if (postcardIds.length === 0) return text('bad id', 400);
    const now = Date.now();
    if (await isDuplicateRequest(env, name, postcardIds, now)) {
      await trackAnalytics(env, 'request_deduped');
      return json({ ok: true, deduped: true });
    }

    for (const id of postcardIds) {
      const card = await env.DB.prepare("SELECT id FROM cards WHERE id=?1 AND status='available'")
        .bind(id)
        .first();
      if (!card) return text('not found', 404);
    }

    for (const postcardId of postcardIds) {
      await env.DB.prepare(
        'INSERT INTO requests (postcard_id, name, message, created_at) VALUES (?1, ?2, ?3, ?4)'
      )
        .bind(postcardId, name, message || null, now)
        .run();
    }

    const requestText = buildAdminRequestText({
      postcardIds,
      name,
      message,
      siteUrl,
      createdAt: now,
    });

    await reserveCards(env, postcardIds, now);
    await trackAnalytics(env, 'request_sent', postcardIds.length, now);
    await notifyAdminsWithRequestCards(env, postcardIds, requestText);
    return json({ ok: true });
  }

  const postcardId = String(singleId || '').trim().toLowerCase();
  if (!/^[0-9a-z]{4,12}$/i.test(postcardId)) return text('bad id', 400);
  const now = Date.now();
  if (await isDuplicateRequest(env, name, [postcardId], now)) {
    await trackAnalytics(env, 'request_deduped');
    return json({ ok: true, deduped: true });
  }

  const card = await env.DB.prepare("SELECT id FROM cards WHERE id=?1 AND status='available'")
    .bind(postcardId)
    .first();

  if (!card) return text('not found', 404);

  await env.DB.prepare(
    'INSERT INTO requests (postcard_id, name, message, created_at) VALUES (?1, ?2, ?3, ?4)'
  )
    .bind(postcardId, name, message || null, now)
    .run();

  const requestText = buildAdminRequestText({
    postcardIds: [postcardId],
    name,
    message,
    siteUrl,
    createdAt: now,
  });

  await reserveCards(env, [postcardId], now);
  await trackAnalytics(env, 'request_sent', 1, now);
  await notifyAdminsWithRequestCard(env, postcardId, requestText);

  return json({ ok: true });
}

async function handleTelegram(request, env) {
  if (request.method !== 'POST') return text('method not allowed', 405);

  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  const expectedSecret = String(env.TG_WEBHOOK_SECRET || '').trim();
  const strictSecretCheck =
    String(env.TG_STRICT_WEBHOOK_SECRET || '')
      .trim()
      .toLowerCase() === 'true' ||
    String(env.TG_STRICT_WEBHOOK_SECRET || '').trim() === '1';

  if (expectedSecret && secret !== expectedSecret) {
    console.log('tg webhook secret mismatch');
    if (strictSecretCheck) return text('unauthorized', 401);
  }

  const update = await request.json().catch(() => ({}));
  const admins = getAdminList(env);

  const callback = update?.callback_query;
  if (callback) {
    const fromId = String(callback.from?.id ?? '');
    const chatId = String(callback.message?.chat?.id ?? fromId);
    const isAdmin = admins.includes(fromId) || admins.includes(chatId);

    if (!isAdmin) {
      await tgApi(env, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Not authorized',
        show_alert: false,
      });
      return json({ ok: true });
    }

    const data = String(callback.data || '');
    const singleMatch = data.match(/^del:([0-9a-z]{4,12})$/i);
    const bulkMatch = data.match(/^delall:([0-9a-z]{6,16})$/i);

    if (!singleMatch && !bulkMatch) {
      await tgApi(env, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Unknown action',
        show_alert: false,
      });
      return json({ ok: true });
    }

    // Acknowledge immediately to stop Telegram loading spinner.
    await tgApi(env, 'answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Processing delete...',
      show_alert: false,
    });

    try {
      if (singleMatch) {
        const id = singleMatch[1].toLowerCase();
        const result = await deleteCardIfExists(env, id, {
          adminChatId: chatId,
          details: { via: 'callback_single' },
        });
        const msg = result.deleted
          ? callbackNoticeText(`🗑️ Removed from gallery: ${id}`, callback)
          : callbackNoticeText(`⚠️ Could not remove ${id}: already missing.`, callback);
        await tgSend(env, chatId, msg);
        return json({ ok: true });
      }

      if (bulkMatch) {
        const token = bulkMatch[1];
        const action = await dbGetAdminAction(env, token);
        if (!action || isActionExpired(action)) {
          if (action) await dbDeleteAdminAction(env, token);
          await tgSend(
            env,
            chatId,
            callbackNoticeText(
              '⚠️ Bulk delete action expired. Open a fresh request message and try again.',
              callback
            )
          );
          return json({ ok: true });
        }

        const ids = parseBulkDeleteIds(action);
        await dbDeleteAdminAction(env, token);

        if (!ids.length) {
          await tgSend(
            env,
            chatId,
            callbackNoticeText('⚠️ Bulk delete action has no valid IDs.', callback)
          );
          return json({ ok: true });
        }

        const results = [];
        for (const id of ids) {
          results.push(
            await deleteCardIfExists(env, id, {
              adminChatId: chatId,
              details: { via: 'callback_bulk' },
            })
          );
        }
        const removedCount = results.filter((x) => x.deleted).length;
        await addAdminEvent(env, {
          action: 'bulk_delete',
          ids,
          adminChatId: chatId,
          details: { removed: removedCount, total: results.length },
        });
        await trackAnalytics(env, 'bulk_delete', 1);
        await tgSend(env, chatId, callbackNoticeText(summarizeBulkDelete(results), callback));
        return json({ ok: true });
      }
    } catch (e) {
      console.log('callback action failed', e);
      await tgSend(
        env,
        chatId,
        callbackNoticeText('❌ Delete action failed. Try again or use /delete <id>.', callback)
      );
      return json({ ok: true });
    }
  }

  const msg = update?.message;
  if (!msg) return json({ ok: true });

  const chatId = String(msg.chat?.id ?? '');
  const username = msg.from?.username ? `@${msg.from.username}` : '(no username)';
  const isAdmin = admins.includes(chatId);
  const msgText = typeof msg.text === 'string' ? normalizeAdminText(msg.text) : '';

  // /myid for everyone
  if (msgText === '/myid') {
    await tgSend(env, chatId, `Your chat_id: ${chatId}\nusername: ${username}`);
    if (env.ADMIN_CHAT_ID) {
      await tgSend(env, String(env.ADMIN_CHAT_ID), `👤 /myid from ${username}: chat_id=${chatId}`);
    }
    return json({ ok: true });
  }

  // User clicked from website: /start pick_<id>
  if (msgText.startsWith('/start')) {
    if (isAdmin) {
      await tgSend(env, chatId, adminHelpText(), adminKeyboard());
    } else {
      await tgSend(
        env,
        chatId,
        '👋 Welcome! Please use the website to browse postcards and send exchange requests.'
      );
    }
    return json({ ok: true });
  }

  // Admin commands
  if (isAdmin && msgText.startsWith('/')) {
    const parts = msgText.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/help' || cmd === '/menu') {
      await tgSend(env, chatId, adminHelpText(), adminKeyboard());
      return json({ ok: true });
    }

    if (cmd === '/stats') {
      await tgSend(env, chatId, `📊 Available postcards: ${await dbStats(env)}`);
      return json({ ok: true });
    }

    if (cmd === '/last') {
      const last = await dbLast(env);
      await tgSend(
        env,
        chatId,
        last ? `🆕 Last: ${last.id}\nhttps://subach.uk/#${last.id}` : 'No postcards yet.'
      );
      return json({ ok: true });
    }

    if (cmd === '/list') {
      const nRaw = Number(parts[1] || '20');
      const n = Number.isFinite(nRaw) ? Math.min(Math.max(nRaw, 1), 200) : 20;
      const ids = await dbList(env, n);
      await tgSend(
        env,
        chatId,
        ids.length ? `🗂️ Last ${ids.length} IDs:\n${ids.join('\n')}` : 'Empty.'
      );
      return json({ ok: true });
    }

    if (cmd === '/recent') {
      const nRaw = Number(parts[1] || '15');
      const n = Number.isFinite(nRaw) ? Math.min(Math.max(nRaw, 1), 50) : 15;
      const events = await listAdminEvents(env, n);
      await tgSend(env, chatId, formatAdminEvents(events), adminKeyboard());
      return json({ ok: true });
    }

    if (cmd === '/analytics') {
      const dRaw = Number(parts[1] || '7');
      const days = Number.isFinite(dRaw) ? Math.min(Math.max(dRaw, 1), 60) : 7;
      const rows = await readAnalytics(env, days);
      await tgSend(env, chatId, formatAnalytics(rows, days), adminKeyboard());
      return json({ ok: true });
    }

    if (cmd === '/webhookinfo') {
      const info = await tgGetWebhookInfo(env);
      await tgSend(env, chatId, formatWebhookInfo(info), adminKeyboard());
      return json({ ok: true });
    }

    if (cmd === '/setwebhook') {
      const setResult = await tgSetWebhook(env);
      const info = await tgGetWebhookInfo(env);
      const textOut =
        (setResult?.ok ? '✅ setWebhook: ok\n' : '❌ setWebhook: failed\n') +
        formatWebhookInfo(info);
      await tgSend(env, chatId, textOut, adminKeyboard());
      return json({ ok: true });
    }

    if (cmd === '/delete') {
      const id = parts[1];
      if (!id) {
        await tgSend(env, chatId, 'Usage: /delete <id>');
        return json({ ok: true });
      }
      const result = await deleteCardIfExists(env, String(id).toLowerCase(), {
        adminChatId: chatId,
        details: { via: 'command_delete' },
      });
      if (!result.deleted) {
        await tgSend(env, chatId, `Not found: ${id}`);
        return json({ ok: true });
      }
      await tgSend(env, chatId, `🗑️ Deleted: ${result.id}`);
      return json({ ok: true });
    }

    await tgSend(env, chatId, 'Unknown command.\n\n' + adminHelpText(), adminKeyboard());
    return json({ ok: true });
  }

  // Non-admin: ignore (except /myid and /start)
  if (!isAdmin) return json({ ok: true });

  // Admin sent document instead of photo
  if (msg.document) {
    await tgSend(env, chatId, 'Please send as Photo (not as file/document).', adminKeyboard());
    return json({ ok: true });
  }

  // Admin sends a photo => add postcard
  const photos = msg.photo;
  if (!Array.isArray(photos) || photos.length === 0) {
    await tgSend(env, chatId, adminHelpText(), adminKeyboard());
    return json({ ok: true });
  }

  const caption = typeof msg.caption === 'string' ? msg.caption : '';
  const category = normalizeCategory(caption);
  const siteUrl = getSiteUrl(env);

  try {
    const large = photos[photos.length - 1];
    const mid = photos[Math.max(0, Math.floor((photos.length - 1) / 2))];

    const id = makeId(6);
    const fullKey = `cards/${id}/full.jpg`;
    const thumbKey = `cards/${id}/thumb.jpg`;

    const fullUrl = await tgGetFileUrl(env, large.file_id);
    const thumbUrl = await tgGetFileUrl(env, mid.file_id);

    const fullBuf = await (await fetch(fullUrl)).arrayBuffer();
    const thumbBuf = await (await fetch(thumbUrl)).arrayBuffer();

    await env.BUCKET.put(fullKey, fullBuf, { httpMetadata: { contentType: 'image/jpeg' } });
    await env.BUCKET.put(thumbKey, thumbBuf, { httpMetadata: { contentType: 'image/jpeg' } });

    await dbInsertCard(env, { id, createdAt: Date.now(), category, imageKey: fullKey, thumbKey });
    await addAdminEvent(env, {
      action: 'add_card',
      ids: [id],
      adminChatId: chatId,
      details: { category },
    });
    await trackAnalytics(env, 'card_added');

    await tgSend(
      env,
      chatId,
      `✅ Added: ${id} (${category})\nGallery: ${siteUrl}/#${id}\nDelete: /delete ${id}`,
      adminKeyboard()
    );
  } catch (e) {
    console.log('upload error', e);
    await tgSend(env, chatId, '❌ Upload failed. Check: npx wrangler tail');
  }

  return json({ ok: true });
}

async function listCards(env, url) {
  await releaseExpiredReservations(env);
  const limitRaw = Number(url.searchParams.get('limit') || '200');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 200;
  const category = String(url.searchParams.get('category') || '').trim().toLowerCase();

  const validCategory = category && CATEGORY_SLUGS.includes(category) ? category : null;
  const sql = validCategory
    ? "SELECT id, created_at, category, status, pending_until FROM cards WHERE status IN ('available','pending') AND category=?1 ORDER BY created_at DESC LIMIT ?2"
    : "SELECT id, created_at, category, status, pending_until FROM cards WHERE status IN ('available','pending') ORDER BY created_at DESC LIMIT ?1";

  const stmt = validCategory
    ? env.DB.prepare(sql).bind(validCategory, limit)
    : env.DB.prepare(sql).bind(limit);
  const { results } = await stmt.all();

  return new Response(
    JSON.stringify({
      items: (results || []).map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        category: r.category || 'other',
        status: r.status === 'pending' ? 'pending' : 'available',
        pendingUntil: Number(r.pending_until || 0) || null,
        thumbUrl: `/thumb/${r.id}.jpg`,
        imageUrl: `/img/${r.id}.jpg`,
      })),
    }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

function getCategories() {
  return json({
    categories: CATEGORY_SLUGS.map((slug) => ({
      slug,
      ...CATEGORIES[slug],
    })),
  });
}

async function serveImage(env, key) {
  const obj = await env.BUCKET.get(key);
  if (!obj) return text('not found', 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(obj.body, { headers });
}

async function runMaintenance(env) {
  const now = Date.now();
  await releaseExpiredReservations(env, now);
  await dbDeleteExpiredAdminActions(env, now).catch((e) =>
    console.log('admin action cleanup failed', e)
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/tg') return handleTelegram(request, env);
    if (url.pathname === '/api/cards') return listCards(env, url);
    if (url.pathname === '/api/request') return handleWebRequest(request, env);

    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json({
        turnstileSiteKey: String(env.TURNSTILE_SITE_KEY || ''),
        siteUrl: String(env.SITE_URL || 'https://subach.uk'),
      });
    }

    if (url.pathname === '/api/categories' && request.method === 'GET') {
      return getCategories();
    }

    const img = url.pathname.match(/^\/img\/([0-9a-z]+)\.jpg$/i);
    if (img) {
      const id = img[1];
      const card = await dbGetCard(env, id);
      if (!card) return text('not found', 404);
      return serveImage(env, card.image_key);
    }

    const th = url.pathname.match(/^\/thumb\/([0-9a-z]+)\.jpg$/i);
    if (th) {
      const id = th[1];
      const card = await dbGetCard(env, id);
      if (!card) return text('not found', 404);
      return serveImage(env, card.thumb_key);
    }

    // Static assets from public/
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env) {
    await runMaintenance(env);
  },
};
