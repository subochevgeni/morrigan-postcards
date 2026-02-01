const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const text = (s, status = 200) => new Response(s, { status });

function makeId(len = 6) {
  const alphabet = "23456789abcdefghijkmnpqrstuvwxyz";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function tgApi(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

async function tgSend(env, chatId, msg) {
  await tgApi(env, "sendMessage", { chat_id: chatId, text: msg });
}

async function tgGetFileUrl(env, fileId) {
  const data = await tgApi(env, "getFile", { file_id: fileId });
  const filePath = data?.result?.file_path;
  if (!filePath) throw new Error("getFile failed");
  return `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`;
}

async function handleTelegram(request, env) {
  if (request.method !== "POST") return text("method not allowed", 405);

  // Проверка secret_token (Telegram шлёт заголовок X-Telegram-Bot-Api-Secret-Token)
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || secret !== env.TG_WEBHOOK_SECRET) return text("unauthorized", 401); // Telegram secret_token механизм :contentReference[oaicite:3]{index=3}

  const update = await request.json();
  const msg = update?.message;
  if (!msg) return json({ ok: true });

  const chatId = String(msg.chat?.id ?? "");
  const isAdmin = chatId === String(env.ADMIN_CHAT_ID);

  // Удаление (только ты): /delete <id>
  if (isAdmin && typeof msg.text === "string" && msg.text.startsWith("/delete")) {
    const parts = msg.text.trim().split(/\s+/);
    const id = parts[1];
    if (!id) {
      await tgSend(env, chatId, "Использование: /delete <id>");
      return json({ ok: true });
    }

    const fullKey = `cards/${id}/full.jpg`;
    const thumbKey = `cards/${id}/thumb.jpg`;

    await env.BUCKET.delete(fullKey);
    await env.BUCKET.delete(thumbKey);
    await env.DB.prepare("DELETE FROM cards WHERE id = ?1").bind(id).run();

    await tgSend(env, chatId, `🗑️ Удалено: ${id}`);
    return json({ ok: true });
  }

  // Друг нажал "выбрать": /start pick_<id>
  if (!isAdmin && typeof msg.text === "string" && msg.text.startsWith("/start")) {
    const m = msg.text.match(/pick_([0-9a-z]+)/i);
    if (m) {
      const pickedId = m[1];
      const who = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? "someone");
      await tgSend(env, env.ADMIN_CHAT_ID, `📩 Запрос открытки: ${pickedId}\nОт: ${who}\nЧат: ${chatId}`);
      await tgSend(env, chatId, `Ок! Я передал запрос владельцу 🙂\nID: ${pickedId}`);
    }
    return json({ ok: true });
  }

  // Добавление открытки (только ты): сообщение с фото
  if (!isAdmin) return json({ ok: true });

  const photos = msg.photo;
  if (!Array.isArray(photos) || photos.length === 0) {
    await tgSend(env, chatId, "Пришли мне фото открытки (как фото, не как файл).");
    return json({ ok: true });
  }

  // Telegram даёт несколько размеров — используем большой + средний как thumb
  const large = photos[photos.length - 1];
  const small = photos[Math.max(0, Math.floor((photos.length - 1) / 2))];

  const id = makeId(6);
  const fullKey = `cards/${id}/full.jpg`;
  const thumbKey = `cards/${id}/thumb.jpg`;

  const fullUrl = await tgGetFileUrl(env, large.file_id);
  const thumbUrl = await tgGetFileUrl(env, small.file_id);

  const fullBuf = await (await fetch(fullUrl)).arrayBuffer();
  const thumbBuf = await (await fetch(thumbUrl)).arrayBuffer();

  await env.BUCKET.put(fullKey, fullBuf, { httpMetadata: { contentType: "image/jpeg" } });
  await env.BUCKET.put(thumbKey, thumbBuf, { httpMetadata: { contentType: "image/jpeg" } });

  await env.DB.prepare(
    "INSERT INTO cards (id, created_at, status, image_key, thumb_key) VALUES (?1, ?2, 'available', ?3, ?4)"
  )
    .bind(id, Date.now(), fullKey, thumbKey)
    .run();

  await tgSend(env, chatId, `✅ Добавлено: ${id}\nСсылка: https://subach.uk/#${id}`);
  return json({ ok: true });
}

async function listCards(env, url) {
  const limitRaw = Number(url.searchParams.get("limit") || "200");
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
  if (!obj) return text("not found", 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(obj.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/tg") return handleTelegram(request, env);
    if (url.pathname === "/api/cards") return listCards(env, url);

    const img = url.pathname.match(/^\/img\/([0-9a-z]+)\.jpg$/i);
    if (img) return serveImage(env, `cards/${img[1]}/full.jpg`);

    const th = url.pathname.match(/^\/thumb\/([0-9a-z]+)\.jpg$/i);
    if (th) return serveImage(env, `cards/${th[1]}/thumb.jpg`);

    // отдаём статику из public/
    return env.ASSETS.fetch(request);
  },
};
