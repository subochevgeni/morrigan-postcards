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
  const byEn = Object.entries(CATEGORIES).find(
    ([slug, { en }]) => en.toLowerCase() === s
  );
  if (byEn) return byEn[0];
  const byRu = Object.entries(CATEGORIES).find(
    ([slug, { ru }]) => ru.toLowerCase() === s
  );
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

function adminKeyboard() {
  return {
    keyboard: [
      [{ text: '📊 Stats' }, { text: '🆕 Last' }],
      [{ text: '🗂️ List 20' }, { text: '🆔 My ID' }],
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
    '/delete <id> — delete postcard'
  );
}

function normalizeAdminText(text) {
  const t = String(text || '').trim();
  if (t === '📊 Stats') return '/stats';
  if (t === '🆕 Last') return '/last';
  if (t === '🗂️ List 20') return '/list 20';
  if (t === '🆔 My ID') return '/myid';
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

async function deleteCardIfExists(env, id) {
  const card = await dbGetCard(env, id);
  if (!card) return { id, deleted: false };

  await env.BUCKET.delete(card.image_key);
  await env.BUCKET.delete(card.thumb_key);
  await dbDeleteCard(env, id);
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

async function notifyAdmins(env, message) {
  for (const adminId of getAdminList(env)) {
    await tgSend(env, adminId, message);
  }
}

function getSiteUrl(env) {
  return String(env.SITE_URL || 'https://subach.uk').replace(/\/$/, '');
}

async function notifyAdminsWithRequestCard(env, postcardId, requestText, imageUrl) {
  const url = imageUrl || `${getSiteUrl(env)}/thumb/${postcardId}.jpg`;
  const deleteKeyboard = buildDeleteInlineKeyboard([postcardId]);
  for (const adminId of getAdminList(env)) {
    const textWithActions = deleteKeyboard
      ? requestText + '\n\n🛠 Quick action: tap button below to remove this card from gallery.'
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
        '\n\n🛠 Quick action: tap ID to remove one card, or Delete all to remove the whole set.'
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

    for (const id of postcardIds) {
      const card = await env.DB.prepare("SELECT id FROM cards WHERE id=?1 AND status='available'")
        .bind(id)
        .first();
      if (!card) return text('not found', 404);
    }

    const now = Date.now();
    for (const postcardId of postcardIds) {
      await env.DB.prepare(
        'INSERT INTO requests (postcard_id, name, message, created_at) VALUES (?1, ?2, ?3, ?4)'
      )
        .bind(postcardId, name, message || null, now)
        .run();
    }

    const requestText =
      '🌍 Запрос с сайта (несколько открыток)\n\n' +
      `📌 Открытки: ${postcardIds.join(', ')}\n` +
      `👤 Имя: ${name}\n` +
      `💬 Сообщение: ${message || '—'}\n\n` +
      `🔗 ${siteUrl}`;

    await notifyAdminsWithRequestCards(env, postcardIds, requestText);
    return json({ ok: true });
  }

  const postcardId = String(singleId || '').trim().toLowerCase();
  if (!/^[0-9a-z]{4,12}$/i.test(postcardId)) return text('bad id', 400);

  const card = await env.DB.prepare("SELECT id FROM cards WHERE id=?1 AND status='available'")
    .bind(postcardId)
    .first();

  if (!card) return text('not found', 404);

  await env.DB.prepare(
    'INSERT INTO requests (postcard_id, name, message, created_at) VALUES (?1, ?2, ?3, ?4)'
  )
    .bind(postcardId, name, message || null, Date.now())
    .run();

  const requestText =
    '🌍 Запрос с сайта (без Telegram)\n\n' +
    `📌 Открытка: ${postcardId}\n` +
    `👤 Имя: ${name}\n` +
    `💬 Сообщение: ${message || '—'}\n\n` +
    `🔗 ${siteUrl}/#${postcardId}`;

  await notifyAdminsWithRequestCard(env, postcardId, requestText);

  return json({ ok: true });
}

async function handleTelegram(request, env) {
  if (request.method !== 'POST') return text('method not allowed', 405);

  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!secret || secret !== env.TG_WEBHOOK_SECRET) return text('unauthorized', 401);

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

    if (singleMatch) {
      const id = singleMatch[1].toLowerCase();
      const result = await deleteCardIfExists(env, id);

      await tgApi(env, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: result.deleted ? `Removed: ${id}` : `Already removed: ${id}`,
        show_alert: false,
      });
      if (result.deleted) {
        await tgSend(env, chatId, callbackNoticeText(`🗑️ Removed from gallery: ${id}`, callback));
      }
      return json({ ok: true });
    }

    if (bulkMatch) {
      const token = bulkMatch[1];
      const action = await dbGetAdminAction(env, token);
      if (!action || isActionExpired(action)) {
        if (action) await dbDeleteAdminAction(env, token);
        await tgApi(env, 'answerCallbackQuery', {
          callback_query_id: callback.id,
          text: 'Action expired. Please use a fresh request message.',
          show_alert: false,
        });
        return json({ ok: true });
      }

      const ids = parseBulkDeleteIds(action);
      await dbDeleteAdminAction(env, token);

      if (!ids.length) {
        await tgApi(env, 'answerCallbackQuery', {
          callback_query_id: callback.id,
          text: 'No valid postcard IDs in this action.',
          show_alert: false,
        });
        return json({ ok: true });
      }

      const results = [];
      for (const id of ids) {
        results.push(await deleteCardIfExists(env, id));
      }

      const removedCount = results.filter((x) => x.deleted).length;
      await tgApi(env, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: `Removed ${removedCount}/${results.length}`,
        show_alert: false,
      });
      await tgSend(env, chatId, callbackNoticeText(summarizeBulkDelete(results), callback));
      return json({ ok: true });
    }

    if (!singleMatch && !bulkMatch) {
      await tgApi(env, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Unknown action',
        show_alert: false,
      });
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
    const m = msgText.match(/pick_([0-9a-z]+)/i);
    if (m && !isAdmin) {
      const pickedId = m[1];
      await notifyAdmins(
        env,
        `📩 Telegram request\nID: ${pickedId}\nFrom: ${username}\nChat: ${chatId}\nLink: https://subach.uk/#${pickedId}`
      );
      await tgSend(env, chatId, `✅ Got it! I forwarded your request.\nID: ${pickedId}`);
      return json({ ok: true });
    }

    if (isAdmin) await tgSend(env, chatId, adminHelpText(), adminKeyboard());
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

    if (cmd === '/delete') {
      const id = parts[1];
      if (!id) {
        await tgSend(env, chatId, 'Usage: /delete <id>');
        return json({ ok: true });
      }
      const result = await deleteCardIfExists(env, String(id).toLowerCase());
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

  // Non-admin: ignore (except /myid and /start pick_)
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
  const limitRaw = Number(url.searchParams.get('limit') || '200');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 200;
  const category = String(url.searchParams.get('category') || '').trim().toLowerCase();

  const validCategory = category && CATEGORY_SLUGS.includes(category) ? category : null;
  const sql = validCategory
    ? "SELECT id, created_at, category FROM cards WHERE status='available' AND category=?1 ORDER BY created_at DESC LIMIT ?2"
    : "SELECT id, created_at, category FROM cards WHERE status='available' ORDER BY created_at DESC LIMIT ?1";

  const stmt = validCategory
    ? env.DB.prepare(sql).bind(validCategory, limit)
    : env.DB.prepare(sql).bind(limit);
  const { results } = await stmt.all();

  return json({
    items: (results || []).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      category: r.category || 'other',
      thumbUrl: `/thumb/${r.id}.jpg`,
      imageUrl: `/img/${r.id}.jpg`,
    })),
  });
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
};
