const BOT_USERNAME = "postcardsubot";

const grid = document.getElementById("grid");
const q = document.getElementById("q");

const modal = document.getElementById("modal");
const closeBtn = document.getElementById("close");
const modalImg = document.getElementById("modalImg");
const modalId = document.getElementById("modalId");
const copyBtn = document.getElementById("copy");
const tgLink = document.getElementById("tg");

let items = [];

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
load();
