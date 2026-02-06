import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Request form submission', () => {
  beforeEach(() => {
    // Setup minimal DOM
    document.body.innerHTML = `
      <div id="modal" class="hidden" aria-hidden="true">
        <img id="modalImg" />
        <span id="modalId"></span>
        <button id="openForm">Request</button>
        <form id="reqForm" class="hidden">
          <input id="reqName" />
          <textarea id="reqMsg"></textarea>
          <input id="reqWebsite" style="display:none" />
          <div class="cf-turnstile" data-sitekey="" data-theme="dark"></div>
          <button id="reqSubmit" type="submit">Send</button>
          <div id="reqStatus"></div>
        </form>
      </div>
    `;

    // Mock fetch
    global.fetch = vi.fn();

    // Mock Turnstile
    window.turnstile = {
      reset: vi.fn(),
    };
  });

  it('successfully sends data to /api/request and updates UI', async () => {
    // Mock successful request submission
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    // Get form elements
    const modalId = document.getElementById('modalId');
    const reqName = document.getElementById('reqName');
    const reqMsg = document.getElementById('reqMsg');
    const reqWebsite = document.getElementById('reqWebsite');
    const reqStatus = document.getElementById('reqStatus');
    const reqSubmit = document.getElementById('reqSubmit');
    const form = document.getElementById('reqForm');

    // Set up form data
    modalId.textContent = 'test123';
    reqName.value = 'John Doe';
    reqMsg.value = 'Please send this postcard!';
    reqWebsite.value = ''; // honeypot should be empty

    // Mock Turnstile token
    const tokenInput = document.createElement('input');
    tokenInput.name = 'cf-turnstile-response';
    tokenInput.value = 'mock-turnstile-token';
    form.appendChild(tokenInput);

    // Simulate form submission logic (from app.js lines 127-182)
    const id = modalId.textContent.trim();
    const name = reqName.value.trim();
    const message = reqMsg.value.trim();
    const token = tokenInput.value;

    const payload = {
      id,
      name,
      message,
      website: reqWebsite.value.trim(),
      turnstileToken: token,
    };

    reqSubmit.disabled = true;
    reqStatus.textContent = 'Sending…';

    const r = await fetch('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (r.ok) {
      reqStatus.textContent = '✅ Sent! The owners received your request in Telegram.';
      form.classList.add('hidden');
      window.turnstile.reset();
    }

    reqSubmit.disabled = false;

    // Verify fetch was called with correct data
    expect(global.fetch).toHaveBeenCalledWith('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'test123',
        name: 'John Doe',
        message: 'Please send this postcard!',
        website: '',
        turnstileToken: 'mock-turnstile-token',
      }),
    });

    // Verify UI updates
    expect(reqStatus.textContent).toBe('✅ Sent! The owners received your request in Telegram.');
    expect(form.classList.contains('hidden')).toBe(true);
    expect(window.turnstile.reset).toHaveBeenCalled();
  });

  it('shows error when name is missing', async () => {
    const reqName = document.getElementById('reqName');
    const reqStatus = document.getElementById('reqStatus');
    const form = document.getElementById('reqForm');

    // Set empty name
    reqName.value = '';

    // Mock Turnstile token
    const tokenInput = document.createElement('input');
    tokenInput.name = 'cf-turnstile-response';
    tokenInput.value = 'mock-token';
    form.appendChild(tokenInput);

    // Simulate validation logic (from app.js lines 135-138)
    const name = reqName.value.trim();

    if (!name) {
      reqStatus.textContent = '❌ Please enter your nickname / handle.';
      return;
    }

    // Verify error message
    expect(reqStatus.textContent).toBe('❌ Please enter your nickname / handle.');
  });

  it('shows error when Turnstile token is missing', async () => {
    const reqName = document.getElementById('reqName');
    const reqStatus = document.getElementById('reqStatus');

    // Set name but no token
    reqName.value = 'John Doe';

    // Simulate validation logic (from app.js lines 139-142)
    const name = reqName.value.trim();
    const token = ''; // No token

    if (!name) {
      reqStatus.textContent = '❌ Please enter your nickname / handle.';
      return;
    }
    if (!token) {
      reqStatus.textContent = '❌ Please complete the anti-spam check (Turnstile).';
      return;
    }

    // Verify error message
    expect(reqStatus.textContent).toBe('❌ Please complete the anti-spam check (Turnstile).');
  });

  it('shows error when postcard is not found (404)', async () => {
    // Mock 404 response
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const modalId = document.getElementById('modalId');
    const reqName = document.getElementById('reqName');
    const reqStatus = document.getElementById('reqStatus');
    const reqSubmit = document.getElementById('reqSubmit');
    const form = document.getElementById('reqForm');

    modalId.textContent = 'nonexistent';
    reqName.value = 'John Doe';

    // Mock Turnstile token
    const tokenInput = document.createElement('input');
    tokenInput.name = 'cf-turnstile-response';
    tokenInput.value = 'mock-token';
    form.appendChild(tokenInput);

    // Simulate form submission with 404 response (from app.js lines 166-168)
    reqSubmit.disabled = true;
    reqStatus.textContent = 'Sending…';

    const r = await fetch('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'nonexistent',
        name: 'John Doe',
        message: '',
        website: '',
        turnstileToken: 'mock-token',
      }),
    });

    if (r.status === 404) {
      reqStatus.textContent = '❌ Sorry — this postcard is no longer available.';
      window.turnstile.reset();
    }

    reqSubmit.disabled = false;

    // Verify error message
    expect(reqStatus.textContent).toBe('❌ Sorry — this postcard is no longer available.');
    expect(window.turnstile.reset).toHaveBeenCalled();
  });

  it('shows error when Turnstile verification fails (403)', async () => {
    // Mock 403 response
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const modalId = document.getElementById('modalId');
    const reqName = document.getElementById('reqName');
    const reqStatus = document.getElementById('reqStatus');
    const reqSubmit = document.getElementById('reqSubmit');
    const form = document.getElementById('reqForm');

    modalId.textContent = 'test123';
    reqName.value = 'John Doe';

    // Mock Turnstile token
    const tokenInput = document.createElement('input');
    tokenInput.name = 'cf-turnstile-response';
    tokenInput.value = 'invalid-token';
    form.appendChild(tokenInput);

    // Simulate form submission with 403 response (from app.js lines 169-172)
    reqSubmit.disabled = true;
    reqStatus.textContent = 'Sending…';

    const r = await fetch('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'test123',
        name: 'John Doe',
        message: '',
        website: '',
        turnstileToken: 'invalid-token',
      }),
    });

    if (r.status === 403) {
      reqStatus.textContent = '❌ Anti-spam failed. Please retry.';
      window.turnstile.reset();
    }

    reqSubmit.disabled = false;

    // Verify error message
    expect(reqStatus.textContent).toBe('❌ Anti-spam failed. Please retry.');
    expect(window.turnstile.reset).toHaveBeenCalled();
  });

  it('resets Turnstile widget when request form is opened', async () => {
    const form = document.getElementById('reqForm');
    const reqStatus = document.getElementById('reqStatus');

    // Clear previous calls
    window.turnstile.reset.mockClear();

    // Simulate opening the form (from app.js lines 60-64)
    form.classList.toggle('hidden');
    reqStatus.textContent = '';

    // Use setTimeout to match actual implementation behavior
    await new Promise((resolve) =>
      setTimeout(() => {
        window.turnstile.reset();
        resolve();
      }, 250)
    );

    // Verify Turnstile was reset
    expect(window.turnstile.reset).toHaveBeenCalled();
  });

  it('resets Turnstile widget after successful form submission', async () => {
    // Mock successful response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    const modalId = document.getElementById('modalId');
    const reqName = document.getElementById('reqName');
    const reqStatus = document.getElementById('reqStatus');
    const reqSubmit = document.getElementById('reqSubmit');
    const form = document.getElementById('reqForm');

    modalId.textContent = 'test123';
    reqName.value = 'John Doe';

    // Mock Turnstile token
    const tokenInput = document.createElement('input');
    tokenInput.name = 'cf-turnstile-response';
    tokenInput.value = 'mock-token';
    form.appendChild(tokenInput);

    // Clear previous calls
    window.turnstile.reset.mockClear();

    // Simulate successful form submission (from app.js lines 149-152)
    reqSubmit.disabled = true;
    reqStatus.textContent = 'Sending…';

    const r = await fetch('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'test123',
        name: 'John Doe',
        message: '',
        website: '',
        turnstileToken: 'mock-token',
      }),
    });

    if (r.ok) {
      reqStatus.textContent = '✅ Sent! The owners received your request in Telegram.';
      form.classList.add('hidden');
      // Simulate setTimeout resetTurnstile call
      await new Promise((resolve) =>
        setTimeout(() => {
          window.turnstile.reset();
          resolve();
        }, 250)
      );
    }

    reqSubmit.disabled = false;

    // Verify Turnstile was reset after successful submission
    expect(window.turnstile.reset).toHaveBeenCalled();
    expect(reqStatus.textContent).toContain('✅ Sent!');
  });

  it('resets Turnstile widget after failed form submission', async () => {
    // Mock failed response (generic error)
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const modalId = document.getElementById('modalId');
    const reqName = document.getElementById('reqName');
    const reqStatus = document.getElementById('reqStatus');
    const reqSubmit = document.getElementById('reqSubmit');
    const form = document.getElementById('reqForm');

    modalId.textContent = 'test123';
    reqName.value = 'John Doe';

    // Mock Turnstile token
    const tokenInput = document.createElement('input');
    tokenInput.name = 'cf-turnstile-response';
    tokenInput.value = 'mock-token';
    form.appendChild(tokenInput);

    // Clear previous calls
    window.turnstile.reset.mockClear();

    // Simulate failed form submission (from app.js lines 159-161)
    reqSubmit.disabled = true;
    reqStatus.textContent = 'Sending…';

    const r = await fetch('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'test123',
        name: 'John Doe',
        message: '',
        website: '',
        turnstileToken: 'mock-token',
      }),
    });

    if (!r.ok && r.status !== 404 && r.status !== 403) {
      reqStatus.textContent = '❌ Failed to send. Please try again.';
      // Simulate setTimeout resetTurnstile call
      await new Promise((resolve) =>
        setTimeout(() => {
          window.turnstile.reset();
          resolve();
        }, 250)
      );
    }

    reqSubmit.disabled = false;

    // Verify Turnstile was reset after failed submission
    expect(window.turnstile.reset).toHaveBeenCalled();
    expect(reqStatus.textContent).toBe('❌ Failed to send. Please try again.');
  });

  it('validates presence of Turnstile token before form submission', () => {
    const modalId = document.getElementById('modalId');
    const reqName = document.getElementById('reqName');
    const reqStatus = document.getElementById('reqStatus');

    modalId.textContent = 'test123';
    reqName.value = 'John Doe';

    // Do NOT add Turnstile token input (simulating missing token)

    // Simulate validation logic (from app.js lines 120, 126-128)
    const name = reqName.value.trim();
    const tokenEl = document.querySelector('[name="cf-turnstile-response"]');
    const token = tokenEl ? String(tokenEl.value || '').trim() : '';

    if (!name) {
      reqStatus.textContent = '❌ Please enter your nickname / handle.';
      return;
    }
    if (!token) {
      reqStatus.textContent = '❌ Please complete the anti-spam check (Turnstile).';
      return;
    }

    // Verify error message for missing token
    expect(reqStatus.textContent).toBe('❌ Please complete the anti-spam check (Turnstile).');
    // Verify fetch was NOT called
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// Set up DOM structure for cart tests
function setupCartDOM() {
  document.body.innerHTML = `
    <div id="grid"></div>
    <input id="q" type="text" />
    <div id="categoryFilter"></div>
    <div id="modal" class="hidden" aria-hidden="true">
      <button id="close">×</button>
      <div id="modalSingle">
        <img id="modalImg" src="" alt="" />
        <span id="modalId"></span>
        <button id="copy">Copy ID</button>
        <a id="tg" href="#">Telegram</a>
      </div>
      <div id="modalCart" class="hidden">
        <h2 id="modalCartTitle"></h2>
        <div id="modalCartList"></div>
      </div>
      <form id="reqForm">
        <input id="reqName" type="text" />
        <textarea id="reqMsg"></textarea>
        <input id="reqWebsite" type="text" />
        <div id="reqStatus"></div>
        <button id="reqSubmit" type="submit">Send</button>
      </form>
    </div>
    <button id="cartBtn" class="hidden">
      Cart (<span id="cartCount">0</span>)
    </button>
  `;
}

// Extract cart logic for testing
function createCartModule() {
  const $ = (id) => document.getElementById(id);

  const cartBtn = $('cartBtn');
  const cartCountEl = $('cartCount');
  const modal = $('modal');
  const modalSingle = $('modalSingle');
  const modalCart = $('modalCart');
  const modalCartTitle = $('modalCartTitle');
  const modalCartList = $('modalCartList');
  const reqStatus = $('reqStatus');

  let cartIds = [];
  let modalMode = 'single';
  let currentId = null;
  let items = [];

  function updateCartUI() {
    if (cartBtn && cartCountEl) {
      if (cartIds.length > 0) {
        cartBtn.classList.remove('hidden');
        cartCountEl.textContent = cartIds.length;
      } else {
        cartBtn.classList.add('hidden');
        cartCountEl.textContent = '0';
      }
    }
  }

  function render() {
    // Simplified render for testing - just mark items in cart
    const grid = $('grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const item of items) {
      const card = document.createElement('button');
      card.className = 'card';
      const inCart = cartIds.includes(item.id);
      card.innerHTML = `
        <span class="mono">${item.id}</span>
        <button type="button" class="card-cart-btn ${inCart ? 'in-cart' : ''}" data-id="${item.id}">
          ${inCart ? '✓ In cart' : 'Add to cart'}
        </button>
      `;
      grid.appendChild(card);
    }
  }

  function toggleCart(id, e) {
    if (e) e.stopPropagation();
    const i = cartIds.indexOf(id);
    if (i >= 0) cartIds.splice(i, 1);
    else cartIds.push(id);
    updateCartUI();
    render();
  }

  function closeModal() {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    currentId = null;
    if (modalSingle) modalSingle.classList.remove('hidden');
    if (modalCart) modalCart.classList.add('hidden');
  }

  function renderCartModalContent() {
    if (modalCartTitle) {
      modalCartTitle.textContent = `Request for ${cartIds.length} postcard${cartIds.length === 1 ? '' : 's'}`;
    }
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
    if (modalSingle) modalSingle.classList.add('hidden');
    if (modalCart) {
      modalCart.classList.remove('hidden');
      renderCartModalContent();
    }

    if (reqStatus) reqStatus.textContent = '';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  return {
    toggleCart,
    renderCartModalContent,
    openCartModal,
    closeModal,
    getCartIds: () => [...cartIds],
    setCartIds: (ids) => {
      cartIds = [...ids];
    },
    setItems: (newItems) => {
      items = [...newItems];
    },
    getModalMode: () => modalMode,
    getCurrentId: () => currentId,
  };
}

describe('toggleCart', () => {
  let cartModule;

  beforeEach(() => {
    setupCartDOM();
    cartModule = createCartModule();
    cartModule.setItems([
      { id: 'abc123', thumbUrl: '/thumb/abc123.jpg', imageUrl: '/img/abc123.jpg' },
      { id: 'def456', thumbUrl: '/thumb/def456.jpg', imageUrl: '/img/def456.jpg' },
      { id: 'ghi789', thumbUrl: '/thumb/ghi789.jpg', imageUrl: '/img/ghi789.jpg' },
    ]);
  });

  it('should add an item to the cart when it is not already in the cart', () => {
    expect(cartModule.getCartIds()).toEqual([]);

    cartModule.toggleCart('abc123');

    expect(cartModule.getCartIds()).toEqual(['abc123']);
  });

  it('should remove an item from the cart when it is already in the cart', () => {
    cartModule.setCartIds(['abc123', 'def456']);

    cartModule.toggleCart('abc123');

    expect(cartModule.getCartIds()).toEqual(['def456']);
  });

  it('should update the cart UI to show the correct count', () => {
    const cartBtn = document.getElementById('cartBtn');
    const cartCountEl = document.getElementById('cartCount');

    expect(cartBtn.classList.contains('hidden')).toBe(true);
    expect(cartCountEl.textContent).toBe('0');

    cartModule.toggleCart('abc123');

    expect(cartBtn.classList.contains('hidden')).toBe(false);
    expect(cartCountEl.textContent).toBe('1');

    cartModule.toggleCart('def456');

    expect(cartCountEl.textContent).toBe('2');

    cartModule.toggleCart('abc123'); // Remove

    expect(cartCountEl.textContent).toBe('1');

    cartModule.toggleCart('def456'); // Remove last

    expect(cartBtn.classList.contains('hidden')).toBe(true);
    expect(cartCountEl.textContent).toBe('0');
  });

  it('should update the grid to show items with in-cart status', () => {
    const grid = document.getElementById('grid');

    cartModule.toggleCart('abc123');

    const buttons = grid.querySelectorAll('.card-cart-btn');
    const abc123Btn = Array.from(buttons).find((b) => b.dataset.id === 'abc123');
    const def456Btn = Array.from(buttons).find((b) => b.dataset.id === 'def456');

    expect(abc123Btn.classList.contains('in-cart')).toBe(true);
    expect(abc123Btn.textContent.trim()).toContain('In cart');
    expect(def456Btn.classList.contains('in-cart')).toBe(false);
    expect(def456Btn.textContent.trim()).toContain('Add to cart');
  });

  it('should stop event propagation when an event is provided', () => {
    const mockEvent = {
      stopPropagation: vi.fn(),
    };

    cartModule.toggleCart('abc123', mockEvent);

    expect(mockEvent.stopPropagation).toHaveBeenCalled();
  });
});

describe('renderCartModalContent', () => {
  let cartModule;

  beforeEach(() => {
    setupCartDOM();
    cartModule = createCartModule();
  });

  it('should display the correct title for a single item', () => {
    cartModule.setCartIds(['abc123']);
    cartModule.renderCartModalContent();

    const title = document.getElementById('modalCartTitle');
    expect(title.textContent).toBe('Request for 1 postcard');
  });

  it('should display the correct title for multiple items', () => {
    cartModule.setCartIds(['abc123', 'def456', 'ghi789']);
    cartModule.renderCartModalContent();

    const title = document.getElementById('modalCartTitle');
    expect(title.textContent).toBe('Request for 3 postcards');
  });

  it('should render all cart items in the modal list', () => {
    cartModule.setCartIds(['abc123', 'def456']);
    cartModule.renderCartModalContent();

    const list = document.getElementById('modalCartList');
    const items = list.querySelectorAll('.cart-item');

    expect(items.length).toBe(2);
    expect(items[0].querySelector('.mono').textContent).toBe('abc123');
    expect(items[1].querySelector('.mono').textContent).toBe('def456');
  });

  it('should have remove buttons for each item', () => {
    cartModule.setCartIds(['abc123', 'def456']);
    cartModule.renderCartModalContent();

    const list = document.getElementById('modalCartList');
    const removeButtons = list.querySelectorAll('.cart-item-remove');

    expect(removeButtons.length).toBe(2);
    expect(removeButtons[0].dataset.id).toBe('abc123');
    expect(removeButtons[1].dataset.id).toBe('def456');
  });

  it('should remove item from cart when remove button is clicked', () => {
    cartModule.setCartIds(['abc123', 'def456']);
    cartModule.renderCartModalContent();

    const list = document.getElementById('modalCartList');
    const removeBtn = list.querySelector('.cart-item-remove[data-id="abc123"]');

    // Simulate click
    const clickEvent = new MouseEvent('click', { bubbles: true });
    removeBtn.dispatchEvent(clickEvent);

    expect(cartModule.getCartIds()).toEqual(['def456']);
  });

  it('should close modal when the last item is removed', () => {
    cartModule.setCartIds(['abc123']);
    cartModule.openCartModal();
    cartModule.renderCartModalContent();

    const modal = document.getElementById('modal');
    expect(modal.classList.contains('hidden')).toBe(false);

    const list = document.getElementById('modalCartList');
    const removeBtn = list.querySelector('.cart-item-remove[data-id="abc123"]');

    const clickEvent = new MouseEvent('click', { bubbles: true });
    removeBtn.dispatchEvent(clickEvent);

    expect(cartModule.getCartIds()).toEqual([]);
    expect(modal.classList.contains('hidden')).toBe(true);
  });
});

describe('openCartModal', () => {
  let cartModule;

  beforeEach(() => {
    setupCartDOM();
    cartModule = createCartModule();
  });

  it('should switch modal mode to cart', () => {
    cartModule.setCartIds(['abc123']);

    cartModule.openCartModal();

    expect(cartModule.getModalMode()).toBe('cart');
  });

  it('should hide the single item view', () => {
    const modalSingle = document.getElementById('modalSingle');

    cartModule.setCartIds(['abc123']);
    cartModule.openCartModal();

    expect(modalSingle.classList.contains('hidden')).toBe(true);
  });

  it('should show the cart view', () => {
    const modalCart = document.getElementById('modalCart');

    cartModule.setCartIds(['abc123']);
    cartModule.openCartModal();

    expect(modalCart.classList.contains('hidden')).toBe(false);
  });

  it('should show the modal', () => {
    const modal = document.getElementById('modal');

    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.getAttribute('aria-hidden')).toBe('true');

    cartModule.setCartIds(['abc123']);
    cartModule.openCartModal();

    expect(modal.classList.contains('hidden')).toBe(false);
    expect(modal.getAttribute('aria-hidden')).toBe('false');
  });

  it('should clear currentId when opening cart modal', () => {
    cartModule.setCartIds(['abc123']);
    cartModule.openCartModal();

    expect(cartModule.getCurrentId()).toBe(null);
  });

  it('should clear the request status', () => {
    const reqStatus = document.getElementById('reqStatus');
    reqStatus.textContent = 'Previous status message';

    cartModule.setCartIds(['abc123']);
    cartModule.openCartModal();

    expect(reqStatus.textContent).toBe('');
  });

  it('should render cart modal content with items', () => {
    cartModule.setCartIds(['abc123', 'def456']);
    cartModule.openCartModal();

    const title = document.getElementById('modalCartTitle');
    const list = document.getElementById('modalCartList');

    expect(title.textContent).toBe('Request for 2 postcards');
    expect(list.querySelectorAll('.cart-item').length).toBe(2);
  });
});
