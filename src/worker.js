// src/worker.js

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const text = (s, status = 200) => new Response(s, { status });

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
      [{ text: '/help' }, { text: '/stats' }, { text: '/last' }],
      [{ text: '/list 20' }, { text: '/myid' }],
      [{ text: '/delete ' }],
    ],
    resize_keyboard: true,
  };
}

function adminHelpText() {
  return (
    '📌 Admin menu\n' +
    '• Send a postcard photo (as Photo) to add it\n\n' +
    'Commands:\n' +
    '/help — this menu\n' +
    '/myid — show chat_id\n' +
    '/stats — how many available\n' +
    '/last — last added\n' +
    '/list [n] — last n IDs\n' +
    '/delete <id> — delete postcard'
  );
}

async function dbGetCard(env, id) {
  const row = await env.DB.prepare(
    'SELECT id, created_at, status, image_key, thumb_key FROM cards WHERE id=?1'
  )
    .bind(id)
    .first();
  return row || null;
}

async function dbInsertCard(env, { id, createdAt, imageKey, thumbKey }) {
  await env.DB.prepare(
    "INSERT INTO cards (id, created_at, status, image_key, thumb_key) VALUES (?1, ?2, 'available', ?3, ?4)"
  )
    .bind(id, createdAt, imageKey, thumbKey)
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

async function notifyAdminsWithPreviews(env, requestedId, requestText) {
  const latest = await dbList(env, 8);
  const unique = [];
  const pushUnique = (x) => {
    if (x && !unique.includes(x)) unique.push(x);
  };
  pushUnique(requestedId);
  for (const id of latest) pushUnique(id);

  // максимум 10
  const ids = unique.slice(0, 10);

  // соберём media array для альбома
  const media = ids.map((id, idx) => ({
    type: 'photo',
    media: `https://subach.uk/thumb/${id}.jpg`,
    caption: idx === 0 ? requestText : `ID: ${id}`,
  }));

  for (const adminId of getAdminList(env)) {
    // Пытаемся отправить альбом; если упадёт — fallback на отдельные sendPhoto
    const res = await tgSendMediaGroup(env, adminId, media);
    if (!res?.ok) {
      await tgSend(env, adminId, requestText);
      for (const id of ids) {
        await tgSendPhoto(env, adminId, `https://subach.uk/thumb/${id}.jpg`, `ID: ${id}`);
      }
    }

    if (latest.length) {
      await tgSend(env, adminId, 'Available IDs (latest):\n' + latest.join('\n'));
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
  if (!usedTestSecret && data.hostname && !String(data.hostname).endsWith('subach.uk')) {
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

  const requestText =
    '🌍 New request (no Telegram)\n' +
    `ID: ${postcardId}\n` +
    `From: ${name}\n` +
    `Message: ${message || '-'}\n` +
    `Link: https://subach.uk/#${postcardId}`;

  await notifyAdminsWithPreviews(env, postcardId, requestText);

  return json({ ok: true });
}

async function handleTelegram(request, env) {
  if (request.method !== 'POST') return text('method not allowed', 405);

  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!secret || secret !== env.TG_WEBHOOK_SECRET) return text('unauthorized', 401);

  const update = await request.json().catch(() => ({}));
  const msg = update?.message;
  if (!msg) return json({ ok: true });

  const chatId = String(msg.chat?.id ?? '');
  const username = msg.from?.username ? `@${msg.from.username}` : '(no username)';

  const admins = getAdminList(env);
  const isAdmin = admins.includes(chatId);

  // /myid for everyone
  if (typeof msg.text === 'string' && msg.text.trim() === '/myid') {
    await tgSend(env, chatId, `Your chat_id: ${chatId}\nusername: ${username}`);
    if (env.ADMIN_CHAT_ID) {
      await tgSend(env, String(env.ADMIN_CHAT_ID), `👤 /myid from ${username}: chat_id=${chatId}`);
    }
    return json({ ok: true });
  }

  // User clicked from website: /start pick_<id>
  if (typeof msg.text === 'string' && msg.text.startsWith('/start')) {
    const m = msg.text.match(/pick_([0-9a-z]+)/i);
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
  if (isAdmin && typeof msg.text === 'string' && msg.text.startsWith('/')) {
    const parts = msg.text.trim().split(/\s+/);
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

      const card = await dbGetCard(env, id);
      if (!card) {
        await tgSend(env, chatId, `Not found: ${id}`);
        return json({ ok: true });
      }

      await env.BUCKET.delete(card.image_key);
      await env.BUCKET.delete(card.thumb_key);
      await dbDeleteCard(env, id);

      await tgSend(env, chatId, `🗑️ Deleted: ${id}`);
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

    await dbInsertCard(env, { id, createdAt: Date.now(), imageKey: fullKey, thumbKey });

    await tgSend(
      env,
      chatId,
      `✅ Added: ${id}\nGallery: https://subach.uk/#${id}\nDelete: /delete ${id}`,
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

  const { results } = await env.DB.prepare(
    "SELECT id, created_at FROM cards WHERE status='available' ORDER BY created_at DESC LIMIT ?1"
  )
    .bind(limit)
    .all();

  return json({
    items: (results || []).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      thumbUrl: `/thumb/${r.id}.jpg`,
      imageUrl: `/img/${r.id}.jpg`,
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
