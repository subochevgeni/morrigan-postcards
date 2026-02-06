const BOT_USERNAME = 'postcardsubot';

let TURNSTILE_SITE_KEY = ''; // fetched from /api/config (public site key)
let SITE_URL = 'https://subach.uk';

async function fetchConfig() {
  try {
    const r = await fetch('/api/config');
    if (!r.ok) {
      console.warn('Failed to fetch config:', r.status);
      return;
    }
    const d = await r.json().catch(() => ({}));
    TURNSTILE_SITE_KEY = d.turnstileSiteKey || '';
    SITE_URL = d.siteUrl || SITE_URL;
  } catch (e) {
    console.warn('Config fetch error:', e);
  }
}

const $ = (id) => document.getElementById(id);

const grid = $('grid');
const q = $('q');
const categoryFilterEl = $('categoryFilter');

let categories = [];
let currentCategory = '';

const modal = $('modal');
const closeBtn = $('close');
const modalImg = $('modalImg');
const modalId = $('modalId');
const copyBtn = $('copy');
const tgLink = $('tg');

const form = $('reqForm');
const reqName = $('reqName');
const reqMsg = $('reqMsg');
const reqWebsite = $('reqWebsite');
const reqStatus = $('reqStatus');
const reqSubmit = $('reqSubmit');

let items = [];
let currentId = null;

function resetTurnstile() {
  try {
    if (window.turnstile && typeof window.turnstile.reset === 'function') {
      // Reset all auto-rendered widgets
      window.turnstile.reset();
    }
  } catch (e) {
    console.warn('Failed to reset Turnstile:', e);
  }
}

function getTurnstileToken() {
  const el = document.querySelector('[name="cf-turnstile-response"]');
  return el ? String(el.value || '').trim() : '';
}

function openModal(item) {
  currentId = item.id;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  modalImg.src = item.imageUrl;
  modalId.textContent = item.id;
  tgLink.href = `https://t.me/${BOT_USERNAME}?start=pick_${item.id}`;

  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(item.id);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy ID'), 900);
  };

  // Reset form
  reqStatus.textContent = '';
  reqName.value = '';
  reqMsg.value = '';
  reqWebsite.value = '';

  // Attempt to reset Turnstile (auto-rendered in DOM)
  setTimeout(() => {
    resetTurnstile();
  }, 150);

  location.hash = item.id;
}

function closeModal() {
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  modalImg.src = '';
  currentId = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

closeBtn.onclick = closeModal;
modal.onclick = (e) => {
  if (e.target === modal) closeModal();
};
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

function render() {
  const needle = (q.value || '').trim().toLowerCase();
  const filtered = needle ? items.filter((x) => x.id.includes(needle)) : items;

  grid.innerHTML = '';
  for (const item of filtered) {
    const card = document.createElement('button');
    card.className = 'card';
    const catLabel = categories.find((c) => c.slug === item.category)?.en || item.category || '';
    card.innerHTML = `
      <img src="${item.thumbUrl}" alt="${item.id}" loading="lazy">
      <div class="meta">ID: <span class="mono">${item.id}</span>${catLabel ? ` · ${catLabel}` : ''}</div>
    `;
    card.onclick = () => openModal(item);
    grid.appendChild(card);
  }
}

function renderCategoryFilter() {
  if (!categoryFilterEl || !categories.length) return;
  categoryFilterEl.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'filter-btn' + (currentCategory === '' ? ' active' : '');
  allBtn.textContent = 'All';
  allBtn.onclick = () => {
    currentCategory = '';
    categoryFilterEl.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    allBtn.classList.add('active');
    load();
  };
  categoryFilterEl.appendChild(allBtn);
  for (const cat of categories) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-btn' + (currentCategory === cat.slug ? ' active' : '');
    btn.textContent = cat.en;
    btn.onclick = () => {
      currentCategory = cat.slug;
      categoryFilterEl.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      load();
    };
    categoryFilterEl.appendChild(btn);
  }
}

async function load() {
  try {
    const params = new URLSearchParams({ limit: '200' });
    if (currentCategory) params.set('category', currentCategory);
    const r = await fetch('/api/cards?' + params.toString());
    if (!r.ok) {
      console.error('Failed to load cards:', r.status, r.statusText);
      return;
    }
    const data = await r.json();
    items = data.items || [];
    render();

    const hashId = (location.hash || '').replace('#', '').trim();
    if (hashId) {
      const found = items.find((x) => x.id === hashId);
      if (found) openModal(found);
    }
  } catch (err) {
    console.error('Failed to load postcards:', err);
  }
}

async function loadCategories() {
  try {
    const r = await fetch('/api/categories');
    if (!r.ok) return;
    const data = await r.json();
    categories = data.categories || [];
    renderCategoryFilter();
  } catch (err) {
    console.warn('Failed to load categories:', err);
  }
}

q.oninput = render;

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  reqStatus.textContent = '';

  if (!currentId) {
    reqStatus.textContent = '❌ Please select a postcard first.';
    return;
  }

  const name = reqName.value.trim();
  const message = reqMsg.value.trim();

  if (!name) {
    reqStatus.textContent = '❌ Please enter your nickname / handle.';
    return;
  }

  const token = getTurnstileToken();
  if (!token) {
    reqStatus.textContent = '❌ Please complete the anti-spam check (Turnstile).';
    return;
  }

  const payload = {
    id: currentId,
    name,
    message,
    website: reqWebsite.value.trim(), // honeypot
    turnstileToken: token,
  };

  reqSubmit.disabled = true;
  reqStatus.textContent = 'Sending…';

  try {
    const r = await fetch('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (r.ok) {
      reqStatus.textContent = '✅ Sent! The owners received your request in Telegram.';
      setTimeout(() => {
        resetTurnstile();
      }, 200);
    } else if (r.status === 404) {
      reqStatus.textContent = '❌ Sorry — this postcard is no longer available.';
      setTimeout(resetTurnstile, 200);
    } else if (r.status === 403) {
      reqStatus.textContent = '❌ Anti-spam failed. Please retry.';
      setTimeout(resetTurnstile, 200);
    } else {
      const t = await r.text().catch(() => '');
      reqStatus.textContent = '❌ Failed to send. ' + (t ? `(${t})` : 'Please try again.');
      setTimeout(resetTurnstile, 200);
    }
  } catch (err) {
    console.error('Request submission error:', err);
    reqStatus.textContent = '❌ Network error. Please try again.';
    setTimeout(resetTurnstile, 200);
  } finally {
    reqSubmit.disabled = false;
  }
});

(async () => {
  await fetchConfig();

  if (!TURNSTILE_SITE_KEY) {
    TURNSTILE_SITE_KEY = '0x4AAAAAACW5TtAmWWLLFZ7V';
  }

  const tsEl = document.querySelector('.cf-turnstile');
  if (tsEl) {
    tsEl.setAttribute('data-sitekey', TURNSTILE_SITE_KEY);
    // With explicit render mode, manually render the widget when Turnstile API is ready
    const renderTurnstile = () => {
      if (window.turnstile && typeof window.turnstile.render === 'function') {
        try {
          window.turnstile.render(tsEl, {
            sitekey: TURNSTILE_SITE_KEY,
            theme: 'dark',
          });
        } catch (e) {
          console.warn('Failed to render Turnstile widget:', e);
        }
      }
    };

    // Try to render immediately if Turnstile is already loaded
    renderTurnstile();

    // Also try when DOMContentLoaded fires (in case script loads after)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderTurnstile);
    }
  }

  await loadCategories();
  load();
})();
