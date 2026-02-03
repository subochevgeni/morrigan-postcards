const BOT_USERNAME = "postcardsubot";
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
let currentId = null;

function getTurnstileToken() {
  const el = document.querySelector('[name="cf-turnstile-response"]');
  return el ? String(el.value || "").trim() : "";
}

function resetTurnstile() {
  try {
    if (window.turnstile && typeof window.turnstile.reset === "function") window.turnstile.reset();
  } catch {}
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

  reqStatus.textContent = "";
  reqName.value = "";
  reqMsg.value = "";
  reqWebsite.value = "";

  // Если через 2 сек. токена всё ещё нет — значит Turnstile не загрузился/не отрендерился
  setTimeout(() => {
    const tokenField = document.querySelector('[name="cf-turnstile-response"]');
    if (!tokenField) {
      reqStatus.textContent =
        "⚠️ Anti-spam widget did not load. Disable ad blocker / privacy extensions and refresh the page.";
    }
  }, 2000);

  setTimeout(resetTurnstile, 250);
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

  if (!currentId) {
    reqStatus.textContent = "❌ Please select a postcard first.";
    return;
  }

  const name = reqName.value.trim();
  const message = reqMsg.value.trim();
  const token = getTurnstileToken();

  if (!name) {
    reqStatus.textContent = "❌ Please enter your nickname / handle.";
    return;
  }
  if (!token) {
    reqStatus.textContent = "❌ Please complete the anti-spam check.";
    return;
  }

  reqSubmit.disabled = true;
  reqStatus.textContent = "Sending…";

  try {
    const r = await fetch("/api/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: currentId,
        name,
        message,
        website: reqWebsite.value.trim(),
        turnstileToken: token
      }),
    });

    if (r.ok) {
      reqStatus.textContent = "✅ Sent! Owners received your request in Telegram.";
      setTimeout(resetTurnstile, 300);
    } else {
      const t = await r.text().catch(() => "");
      reqStatus.textContent = `❌ Failed (${r.status}). ${t}`.trim();
      setTimeout(resetTurnstile, 300);
    }
  } catch {
    reqStatus.textContent = "❌ Network error. Please try again.";
    setTimeout(resetTurnstile, 300);
  } finally {
    reqSubmit.disabled = false;
  }
});

load();
