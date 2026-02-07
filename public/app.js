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
const selectionSummaryEl = $('selectionSummary');

let categories = [];
let currentCategory = '';

const modal = $('modal');
const closeBtn = $('close');
const modalImg = $('modalImg');
const modalId = $('modalId');
const modalSingle = $('modalSingle');
const modalCart = $('modalCart');
const modalCartTitle = $('modalCartTitle');
const modalCartList = $('modalCartList');
const copyBtn = $('copy');
const cartBtn = $('cartBtn');
const cartCountEl = $('cartCount');
const mobileCta = $('mobileCta');
const mobileCtaCount = $('mobileCtaCount');
const mobileOpenCart = $('mobileOpenCart');

const form = $('reqForm');
const reqName = $('reqName');
const reqMsg = $('reqMsg');
const reqWebsite = $('reqWebsite');
const reqStatus = $('reqStatus');
const reqSubmit = $('reqSubmit');

let items = [];
let currentId = null;
let currentCardStatus = 'available';
let cartIds = [];
let modalMode = 'single';
let isLoadingCards = false;
let autoRefreshTimer = null;
let itemsFingerprint = '';
let hasRenderedGrid = false;
let gridHasLoadError = false;

const AUTO_REFRESH_MS = 5000;

function makeItemsFingerprint(list) {
  return list
    .map(
      (item) =>
        `${item.id}|${item.status || 'available'}|${item.pendingUntil || ''}|${item.thumbUrl || ''}|${item.imageUrl || ''}`
    )
    .join(';');
}

function updateSelectionSummary(filteredCount = null) {
  if (!selectionSummaryEl) return;
  const visible = filteredCount == null ? items.length : filteredCount;
  const suffix = visible === 1 ? '' : 's';
  const pickedSuffix = cartIds.length === 1 ? '' : 's';
  const pendingCount = items.filter((x) => x.status === 'pending').length;
  const pendingSuffix = pendingCount === 1 ? '' : 's';
  selectionSummaryEl.textContent = `${visible} postcard${suffix} shown · ${cartIds.length} selected postcard${pickedSuffix}${pendingCount ? ` · ${pendingCount} pending postcard${pendingSuffix}` : ''}`;
}

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
  modalMode = 'single';
  currentId = item.id;
  if (modalSingle) modalSingle.classList.remove('hidden');
  if (modalCart) modalCart.classList.add('hidden');

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  modalImg.src = item.imageUrl;
  modalId.textContent = item.id;
  currentCardStatus = item.status || 'available';

  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(item.id);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy ID'), 900);
  };

  reqStatus.textContent = '';
  reqName.value = '';
  reqMsg.value = '';
  reqWebsite.value = '';

  setTimeout(() => resetTurnstile(), 150);
  location.hash = item.id;
}

function toggleCart(id, e) {
  if (e) e.stopPropagation();
  const i = cartIds.indexOf(id);
  if (i >= 0) cartIds.splice(i, 1);
  else cartIds.push(id);
  updateCartUI();
  render();
}

function updateCartUI() {
  if (cartBtn && cartCountEl) {
    cartCountEl.textContent = String(cartIds.length);
    cartBtn.disabled = cartIds.length === 0;
    cartBtn.setAttribute(
      'aria-label',
      cartIds.length === 0
        ? 'No postcards selected yet'
        : `Open selected postcards (${cartIds.length})`
    );
  }
  if (mobileCta && mobileCtaCount && mobileOpenCart) {
    const hasItems = cartIds.length > 0;
    mobileCtaCount.textContent = String(cartIds.length);
    mobileCta.classList.toggle('hidden', !hasItems);
    mobileCta.setAttribute('aria-hidden', hasItems ? 'false' : 'true');
    mobileOpenCart.disabled = !hasItems;
  }
  updateSelectionSummary();
}

function renderCartModalContent() {
  if (modalCartTitle) modalCartTitle.textContent = `Request for ${cartIds.length} postcard${cartIds.length === 1 ? '' : 's'}`;
  if (!modalCartList) return;
  modalCartList.innerHTML = '';
  for (const id of cartIds) {
    const span = document.createElement('span');
    span.className = 'cart-item';
    span.innerHTML = `<span class="mono">${id}</span><button type="button" class="cart-item-remove" data-id="${id}" aria-label="Remove from cart">×</button>`;
    span.querySelector('.cart-item-remove').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCart(id);
      if (cartIds.length === 0) closeModal();
      else renderCartModalContent();
    };
    modalCartList.appendChild(span);
  }
}

function openCartModal() {
  modalMode = 'cart';
  currentId = null;
  currentCardStatus = 'available';
  if (modalSingle) modalSingle.classList.add('hidden');
  if (modalCart) {
    modalCart.classList.remove('hidden');
    renderCartModalContent();
  }

  reqStatus.textContent = '';
  setTimeout(() => resetTurnstile(), 150);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  modalImg.src = '';
  currentId = null;
  if (modalSingle) modalSingle.classList.remove('hidden');
  if (modalCart) modalCart.classList.add('hidden');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

closeBtn.onclick = closeModal;
modal.onclick = (e) => {
  if (e.target === modal) closeModal();
};
if (cartBtn) cartBtn.onclick = () => openCartModal();
if (mobileOpenCart) mobileOpenCart.onclick = () => openCartModal();
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

function getStatusMeta(item) {
  if (item.status === 'pending') {
    return {
      badgeClass: 'pending',
      badgeText: 'Pending',
      canSelect: false,
      buttonClass: 'is-pending',
      buttonLabel: 'Pending',
    };
  }
  return {
    badgeClass: 'available',
    badgeText: 'Available',
    canSelect: true,
    buttonClass: '',
    buttonLabel: null,
  };
}

function render() {
  const needle = (q.value || '').trim().toLowerCase();
  const filtered = needle ? items.filter((x) => x.id.includes(needle)) : items;

  grid.innerHTML = '';
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML =
      '<strong>No postcards found.</strong><span>Try another ID fragment or clear search/filter.</span>';
    grid.appendChild(empty);
    updateSelectionSummary(0);
    return;
  }

  for (const item of filtered) {
    const card = document.createElement('button');
    card.className = 'card';
    const catLabel = categories.find((c) => c.slug === item.category)?.en || item.category || '';
    const statusMeta = getStatusMeta(item);
    const inCart = cartIds.includes(item.id);
    const buttonText = inCart ? '✓ In cart' : statusMeta.buttonLabel || 'Add to cart';
    const buttonDisabled = !statusMeta.canSelect ? 'disabled' : '';
    card.innerHTML = `
      <img class="thumb-img" src="${item.thumbUrl}" alt="${item.id}" loading="lazy">
      <div class="meta">
        <div class="card-meta-row">
          <span>ID: <span class="mono">${item.id}</span>${catLabel ? ` · ${catLabel}` : ''}</span>
          <span class="card-status ${statusMeta.badgeClass}">${statusMeta.badgeText}</span>
          <button type="button" class="card-cart-btn ${inCart ? 'in-cart' : ''} ${statusMeta.buttonClass}" data-id="${item.id}" ${buttonDisabled} aria-label="${inCart ? 'Remove from cart' : 'Add to cart'}">${buttonText}</button>
        </div>
      </div>
    `;
    card.onclick = () => openModal(item);
    const img = card.querySelector('.thumb-img');
    if (img) {
      if (img.complete) img.classList.add('loaded');
      else img.onload = () => img.classList.add('loaded');
    }
    const cartBtnEl = card.querySelector('.card-cart-btn');
    if (cartBtnEl && statusMeta.canSelect) cartBtnEl.onclick = (e) => toggleCart(item.id, e);
    grid.appendChild(card);
  }

  updateSelectionSummary(filtered.length);
  hasRenderedGrid = true;
  gridHasLoadError = false;
}

function renderLoadError(statusOrMessage) {
  const msg =
    typeof statusOrMessage === 'number'
      ? `Failed to load postcards (HTTP ${statusOrMessage}).`
      : String(statusOrMessage || 'Failed to load postcards.');
  grid.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'empty-state error';
  box.innerHTML = `<strong>${msg}</strong><span>Please check your connection and retry.</span>`;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn';
  retry.textContent = 'Retry';
  retry.onclick = () => load();
  box.appendChild(retry);
  grid.appendChild(box);
  gridHasLoadError = true;
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
  if (isLoadingCards) return;
  isLoadingCards = true;

  try {
    const params = new URLSearchParams({ limit: '200' });
    if (currentCategory) params.set('category', currentCategory);
    const r = await fetch('/api/cards?' + params.toString(), { cache: 'no-store' });
    if (!r.ok) {
      console.error('Failed to load cards:', r.status, r.statusText);
      renderLoadError(r.status);
      return;
    }
    const data = await r.json();
    const nextItems = data.items || [];
    const nextFingerprint = makeItemsFingerprint(nextItems);
    const shouldRenderGrid =
      !hasRenderedGrid || gridHasLoadError || nextFingerprint !== itemsFingerprint;
    items = nextItems;

    const selectableIds = new Set(items.filter((x) => x.status !== 'pending').map((x) => x.id));
    const prevCartSize = cartIds.length;
    cartIds = cartIds.filter((id) => selectableIds.has(id));
    if (cartIds.length !== prevCartSize) updateCartUI();

    if (shouldRenderGrid) {
      render();
      itemsFingerprint = nextFingerprint;
    }

    const hashId = (location.hash || '').replace('#', '').trim();
    if (hashId) {
      const found = items.find((x) => x.id === hashId);
      const modalClosed = modal.classList.contains('hidden');
      if (found && modalClosed && currentId !== hashId) {
        openModal(found);
      } else if (found && currentId === hashId) {
        currentCardStatus = found.status || 'available';
      } else if (!found && currentId === hashId) {
        closeModal();
      }
    }
  } catch (err) {
    console.error('Failed to load postcards:', err);
    renderLoadError('Network error while loading postcards');
  } finally {
    isLoadingCards = false;
  }
}

function scheduleAutoRefresh() {
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
  autoRefreshTimer = setTimeout(async () => {
    if (!document.hidden) {
      await load();
    }
    scheduleAutoRefresh();
  }, AUTO_REFRESH_MS);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});

window.addEventListener('focus', () => {
  load();
});

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

  const isCart = modalMode === 'cart' && cartIds.length > 0;
  if (!isCart && currentCardStatus === 'pending') {
    reqStatus.textContent = '❌ This postcard is currently pending another request.';
    return;
  }
  if (!isCart && !currentId) {
    reqStatus.textContent = '❌ Please select a postcard or add some to the cart first.';
    return;
  }

  const payload = {
    name,
    message,
    website: reqWebsite.value.trim(),
    turnstileToken: token,
  };
  if (isCart) payload.ids = cartIds.slice();
  else payload.id = currentId;

  reqSubmit.disabled = true;
  reqStatus.textContent = 'Sending…';

  try {
    const r = await fetch('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (r.ok) {
      const payloadData = await r.json().catch(() => ({}));
      if (payloadData?.deduped) {
        reqStatus.textContent =
          'ℹ️ Similar request was already sent recently. We will still review it.';
      } else {
        reqStatus.textContent = '✅ Request sent! We will review it and contact you.';
      }
      if (isCart) {
        cartIds = [];
        updateCartUI();
        setTimeout(closeModal, 1200);
      } else {
        setTimeout(closeModal, 1200);
      }
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
  updateCartUI();
  load();
  scheduleAutoRefresh();
})();
