const BOT_USERNAME = "postcardsubot";

// ✅ PASTE Turnstile Site Key (NOT secret) here
const TURNSTILE_SITE_KEY = "0x4AAAAAACW5TtAmWWLLFZ7V";

const $ = (id) => document.getElementById(id);

const grid = $("grid");
const q = $("q");

const modal = $("modal");
const closeBtn = $("close");
const modalImg = $("modalImg");
const modalId = $("modalId");
const copyBtn = $("copy");
const tgLink = $("tg");

const form = $("reqForm");
const reqName = $("reqName");
const reqMsg = $("reqMsg");
const reqWebsite = $("reqWebsite");
const reqStatus = $("reqStatus");
const reqSubmit = $("reqSubmit");

let items = [];
let tsWidgetId = null;
let currentId = null;

function ensureTurnstileRendered() {
  // Turnstile script loads async; render when available
  if (!window.turnstile) return false;
  if (tsWidgetId !== null) return true;

  tsWidgetId = window.turnstile.render("#tsWidget", {
    sitekey: TURNSTILE_SITE_KEY,
    theme: "dark",
  });
  return true;
}

function resetTurnstile() {
  try {
    if (window.turnstile && tsWidgetId !== null) {
      window.turnstile.reset(tsWidgetId);
    }
  } catch {}
}

function getTurnstileToken() {
  try {
    if (window.turnstile && tsWidgetId !== null) {
      return String(window.turnstile.getResponse(tsWidgetId) || "").trim();
    }
  } catch {}
  return "";
}

function openModal(item) {
  currentId = item.id;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  modalImg.src = item.imageUrl;
  modalId.textContent = item.id;
  tgLink.href = `https://t.me/${BOT_USERNAME}?start=pick_${item.id}`;

  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(item.id);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy ID"), 900);
  };

  // Reset form
  reqStatus.textContent = "";
  reqName.value = "";
  reqMsg.value = "";
  reqWebsite.value = "";

  // Render Turnstile (retry a few times if script not ready yet)
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (ensureTurnstileRendered()) {
      clearInterval(timer);
      setTimeout(resetTurnstile, 150);
    } else if (tries >= 20) {
      clearInterval(timer);
      reqStatus.textContent = "❌ Anti-spam widget failed to load. Please refresh the page.";
    }
  }, 150);

  location.hash = item.id;
}

function closeModal() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  modalImg.src = "";
  currentId = null;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

closeBtn.onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

function render() {
  const needle = (q.value || "").trim().toLowerCase();
  const filtered = needle ? items.filter(x => x.id.includes(needle)) : items;

  grid.innerHTML = "";
  for (const item of filtered) {
    const card = document.createElement("button");
    card.className = "card";
    card.innerHTML = `
      <img src="${item.thumbUrl}" alt="${item.id}">
      <div class="meta">ID: <span class="mono">${item.id}</span></div>
    `;
    card.onclick = () => openModal(item);
    grid.appendChild(card);
  }
}

async function load() {
  const r = await fetch("/api/cards?limit=200");
  const data = await r.json();
  items = data.items || [];
  render();

  const hashId = (location.hash || "").replace("#", "").trim();
  if (hashId) {
    const found = items.find(x => x.id === hashId);
    if (found) openModal(found);
  }
}

q.oninput = render;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  reqStatus.textContent = "";

  if (!currentId) {
    reqStatus.textContent = "❌ Please select a postcard first.";
    return;
  }

  const name = reqName.value.trim();
  const message = reqMsg.value.trim();

  if (!name) {
    reqStatus.textContent = "❌ Please enter your nickname / handle.";
    return;
  }

  // Ensure Turnstile is ready
  if (!ensureTurnstileRendered()) {
    reqStatus.textContent = "⏳ Loading anti-spam… please wait a moment.";
    return;
  }

  const token = getTurnstileToken();
  if (!token) {
    reqStatus.textContent = "❌ Please complete the anti-spam check.";
    return;
  }

  const payload = {
    id: currentId,
    name,
    message,
    website: reqWebsite.value.trim(), // honeypot
    turnstileToken: token
  };

  reqSubmit.disabled = true;
  reqStatus.textContent = "Sending…";

  try {
    const r = await fetch("/api/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (r.ok) {
      reqStatus.textContent = "✅ Sent! The owners received your request in Telegram.";
      setTimeout(() => {
        resetTurnstile();
      }, 200);
    } else if (r.status === 404) {
      reqStatus.textContent = "❌ Sorry — this postcard is no longer available.";
      setTimeout(resetTurnstile, 200);
    } else if (r.status === 403) {
      reqStatus.textContent = "❌ Anti-spam failed. Please retry.";
      setTimeout(resetTurnstile, 200);
    } else {
      const t = await r.text().catch(() => "");
      reqStatus.textContent = "❌ Failed to send. " + (t ? `(${t})` : "Please try again.");
      setTimeout(resetTurnstile, 200);
    }
  } catch {
    reqStatus.textContent = "❌ Network error. Please try again.";
    setTimeout(resetTurnstile, 200);
  } finally {
    reqSubmit.disabled = false;
  }
});

load();
