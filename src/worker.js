// src/worker.js

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const text = (s, status = 200) => new Response(s, { status });

function makeId(len = 6) {
  const alphabet = "23456789abcdefghijkmnpqrstuvwxyz"; // без 0/1/l/o
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function getAdminList(env) {
  // backward compatible: если ADMIN_CHAT_IDS нет, используем ADMIN_CHAT_ID
  const raw = (env.ADMIN_CHAT_IDS || String(env.ADMIN_CHAT_ID || "")).trim();
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function tgApi(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!data?.ok) {
    // не кидаем наружу токены/секреты; просто логируем в воркер
    console.log("tgApi error", method, data);
  }
  return data;
}

async function tgSend(env, chatId, msg, replyMarkup = null) {
  const payload = { chat_id: chatId, text: msg };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await tgApi(env, "sendMessage", payload);
}

async function tgGetFileUrl(env, fileId) {
  const data = await tgApi(env, "getFile", { file_id: fileId });
  const filePath = data?.result?.file_path;
  if (!filePath) throw new Error("getFile failed");
  return `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`;
}

function adminHelpText() {
  return (
    "📌 Admin menu\n" +
    "• Просто пришли ФОТО (как Photo) — добавлю открытку\n\n" +
    "Команды:\n" +
    "/help — это меню\n" +
    "/myid — показать chat_id\n" +
    "/stats — сколько доступно\n" +
    "/last — последняя добавленная\n" +
    "/list [n] — последние n ID (по умолчанию 20)\n" +
    "/delete <id> — удалить открытку"
  );
}

function adminHelpKeyboard() {
  // Небольшая подсказка-клавиатура (не обязательна, но удобно)
  return {
    keyboard: [
      [{ text: "/help" }, { text: "/stats" }, { text: "/last" }],
      [{ text: "/list 20" }, { text: "/myid" }],
      [{ text: "/delete " }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function dbGetCard(env, id) {
  const row = await env.DB.prepare(
    "SELECT id, created_at, status, image_key, thumb_key FROM cards WHERE id=?1"
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
  await env.DB.prepare("DELETE FROM cards WHERE id=?1").bind(id).run();
}

async function dbStats(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM cards WHERE status='available'"
  ).first();
  return Number(row?.cnt || 0);
}

async function dbLast(env) {
  const row = await env.DB.prepare(
    "SELECT id, created_at FROM cards WHERE status='available' ORDER BY created_at DESC LIMIT 1"
  ).first();
  return row || null;
}

async function dbList(env, limit) {
  const { results } = await env.DB.prepare(
    "SELECT id FROM cards WHERE status='available' ORDER BY created_at DESC LIMIT ?1"
  )
    .bind(limit)
    .all();
  return (results || []).map((r) => r.id);
}

async function handleTelegram(request, env) {
  if (request.method !== "POST") return text("method not allowed", 405);

  // Проверка секретного токена webhook
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || secret !== env.TG_WEBHOOK_SECRET) return text("unauthorized", 401);

  const update = await request.json().catch(() => ({}));
  const msg = update?.message;
  if (!msg) return json({ ok: true });

  const chatId = String(msg.chat?.id ?? "");
  const username = msg.from?.username ? `@${msg.from.username}` : "(no username)";

  const admins = getAdminList(env);
  const isAdmin = admins.includes(chatId);

  // /myid — доступно всем (чтобы быстро добавлять новых админов)
  if (typeof msg.text === "string" && msg.text.trim() === "/myid") {
    await tgSend(env, chatId, `Ваш chat_id: ${chatId}\nusername: ${username}`);
    // уведомим основного админа (пусть ADMIN_CHAT_ID остаётся “главным”)
    if (env.ADMIN_CHAT_ID) {
      await tgSend(env, String(env.ADMIN_CHAT_ID), `👤 /myid от ${username}: chat_id=${chatId}`);
    }
    return json({ ok: true });
  }

  // /start pick_<id> — любой пользователь выбирает открытку через ссылку с сайта
  if (typeof msg.text === "string" && msg.text.startsWith("/start")) {
    const m = msg.text.match(/pick_([0-9a-z]+)/i);
    if (m && !isAdmin) {
      const pickedId = m[1];
      if (env.ADMIN_CHAT_ID) {
        await tgSend(
          env,
          String(env.ADMIN_CHAT_ID),
          `📩 Запрос открытки: ${pickedId}\nОт: ${username}\nЧат: ${chatId}`
        );
      }
      await tgSend(env, chatId, `Ок! Я передал запрос владельцу 🙂\nID: ${pickedId}`);
      return json({ ok: true });
    }

    // Админу по /start тоже покажем меню
    if (isAdmin) {
      await tgSend(env, chatId, adminHelpText(), adminHelpKeyboard());
    }
    return json({ ok: true });
  }

  // Админские команды
  if (isAdmin && typeof msg.text === "string" && msg.text.startsWith("/")) {
    const parts = msg.text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === "/help" || cmd === "/menu") {
      await tgSend(env, chatId, adminHelpText(), adminHelpKeyboard());
      return json({ ok: true });
    }

    if (cmd === "/stats") {
      const cnt = await dbStats(env);
      await tgSend(env, chatId, `📊 Доступно открыток: ${cnt}`);
      return json({ ok: true });
    }

    if (cmd === "/last") {
      const last = await dbLast(env);
      if (!last) {
        await tgSend(env, chatId, "Пока нет открыток.");
      } else {
        await tgSend(
          env,
          chatId,
          `🆕 Последняя: ${last.id}\nhttps://subach.uk/#${last.id}`
        );
      }
      return json({ ok: true });
    }

    if (cmd === "/list") {
      const nRaw = Number(parts[1] || "20");
      const n = Number.isFinite(nRaw) ? Math.min(Math.max(nRaw, 1), 200) : 20;
      const ids = await dbList(env, n);
      if (!ids.length) await tgSend(env, chatId, "Список пуст.");
      else await tgSend(env, chatId, `🗂️ Последние ${ids.length} ID:\n` + ids.join("\n"));
      return json({ ok: true });
    }

    if (cmd === "/delete") {
      const id = parts[1];
      if (!id) {
        await tgSend(env, chatId, "Использование: /delete <id>");
        return json({ ok: true });
      }

      const card = await dbGetCard(env, id);
      if (!card) {
        await tgSend(env, chatId, `Не нашёл ID: ${id}`);
        return json({ ok: true });
      }

      // удаляем файлы и запись
      await env.BUCKET.delete(card.image_key);
      await env.BUCKET.delete(card.thumb_key);
      await dbDeleteCard(env, id);

      await tgSend(env, chatId, `🗑️ Удалено: ${id}`);
      return json({ ok: true });
    }

    // Неизвестная команда админа — покажем меню
    await tgSend(env, chatId, "Не понял команду.\n\n" + adminHelpText(), adminHelpKeyboard());
    return json({ ok: true });
  }

  // Если не админ — игнорируем всё, кроме /myid и /start pick_...
  if (!isAdmin) return json({ ok: true });

  // Админ прислал документ вместо Photo — подскажем
  if (msg.document) {
    await tgSend(
      env,
      chatId,
      "Пришли картинку как PHOTO (не как файл/document), тогда появится миниатюра и всё будет красиво.\n\n" +
        adminHelpText(),
      adminHelpKeyboard()
    );
    return json({ ok: true });
  }

  // Добавление открытки: админ прислал фото
  const photos = msg.photo;
  if (!Array.isArray(photos) || photos.length === 0) {
    // ничего полезного — покажем меню
    await tgSend(env, chatId, adminHelpText(), adminHelpKeyboard());
    return json({ ok: true });
  }

  try {
    const large = photos[photos.length - 1]; // самый большой
    const thumbSrc = photos[Math.max(0, Math.floor((photos.length - 1) / 2))]; // средний

    const id = makeId(6);
    const fullKey = `cards/${id}/full.jpg`;
    const thumbKey = `cards/${id}/thumb.jpg`;

    const fullUrl = await tgGetFileUrl(env, large.file_id);
    const thumbUrl = await tgGetFileUrl(env, thumbSrc.file_id);

    const fullBuf = await (await fetch(fullUrl)).arrayBuffer();
    const thumbBuf = await (await fetch(thumbUrl)).arrayBuffer();

    await env.BUCKET.put(fullKey, fullBuf, { httpMetadata: { contentType: "image/jpeg" } });
    await env.BUCKET.put(thumbKey, thumbBuf, { httpMetadata: { contentType: "image/jpeg" } });

    await dbInsertCard(env, {
      id,
      createdAt: Date.now(),
      imageKey: fullKey,
      thumbKey: thumbKey,
    });

    await tgSend(
      env,
      chatId,
      `✅ Добавлено: ${id}\n` +
        `Витрина: https://subach.uk/#${id}\n` +
        `Удалить: /delete ${id}`,
      adminHelpKeyboard()
    );
  } catch (e) {
    console.log("upload error", e);
    await tgSend(env, chatId, "❌ Ошибка при добавлении. Посмотри логи wrangler tail.");
  }

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
    if (img) {
      const id = img[1];
      const card = await dbGetCard(env, id);
      if (!card) return text("not found", 404);
      return serveImage(env, card.image_key);
    }

    const th = url.pathname.match(/^\/thumb\/([0-9a-z]+)\.jpg$/i);
    if (th) {
      const id = th[1];
      const card = await dbGetCard(env, id);
      if (!card) return text("not found", 404);
      return serveImage(env, card.thumb_key);
    }

    // отдаём статику из public/
    return env.ASSETS.fetch(request);
  },
};