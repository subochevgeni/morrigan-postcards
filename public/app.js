const BOT_USERNAME = "postcardsubot";

// TODO: paste your Turnstile Site Key here (NOT secret)
const TURNSTILE_SITE_KEY = "0x4AAAAAACW5TtAmWWLLFZ7V";

const grid = document.getElementById("grid");
const q = document.getElementById("q");

const modal = document.getElementById("modal");
const closeBtn = document.getElementById("close");
const modalImg = document.getElementById("modalImg");
const modalId = document.getElementById("modalId");
const copyBtn = document.getElementById("copy");
const tgLink = document.getElementById("tg");

const openFormBtn = document.getElementById("openForm");
const form = document.getElementById("reqForm");
const reqName = document.getElementById("reqName");
const reqMsg = document.getElementById("reqMsg");
const reqWebsite = document.getElementById("reqWebsite");
const reqStatus = document.getElementById("reqStatus");
const reqSubmit = document.getElementById("reqSubmit");
const tsWidget = document.getElementById("tsWidget");

let items = [];
let turnstileRendered = false;

function getTurnstileToken() {
  const el = document.querySelector('[name="cf-turnstile-response"]');
  return el ? String(el.value || "").trim() : "";
}

function ensureTurnstile() {
  if (turnstileRendered) return;
  // implicit render container
  tsWidget.setAttribute("data-sitekey", TURNSTILE_SITE_KEY);
  tsWidget.setAttribute("data-theme", "dark");
  // Turnstile script will render it automatically
  turnstileRendered = true;
}

function resetTurnstile() {
  // if API loaded, reset the first widget on the page
  try {
    if (window.turnstile && typeof window.turnstile.reset === "function") {
      window.turnstile.reset();
    }
  } catch {}
}

function openModal(item) {
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

  openFormBtn.onclick = () => {
    form.classList.toggle("hidden");
    reqStatus.textContent = "";
    if (!form.classList.contains("hidden")) {
      ensureTurnstile();
      setTimeout(resetTurnstile, 200);
    }
  };

  // reset form state each time
  form.classList.add("hidden");
  reqStatus.textContent = "";
  reqName.value = "";
  reqMsg.value = "";
  reqWebsite.value = "";

  location.hash = item.id;
}

function closeModal() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  modalImg.src = "";
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

  const id = modalId.textContent.trim();
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

  const payload = {
    id,
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
      reqStatus.textContent = "✅ Sent! The owner got your request in Telegram.";
      form.classList.add("hidden");
      setTimeout(resetTurnstile, 200);
    } else if (r.status === 404) {
      reqStatus.textContent = "❌ Sorry — this postcard is no longer available.";
      setTimeout(resetTurnstile, 200);
    } else if (r.status === 403) {
      reqStatus.textContent = "❌ Anti-spam failed. Please retry.";
      setTimeout(resetTurnstile, 200);
    } else {
      reqStatus.textContent = "❌ Failed to send. Please try again.";
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
