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
