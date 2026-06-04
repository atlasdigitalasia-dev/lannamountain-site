/**
 * Be Li Tailor Chat Widget
 * Drop-in embed: <script src="chat-widget.js" data-server="https://your-server.com"></script>
 */
(function () {
  const SERVER = document.currentScript?.dataset?.server || 'http://localhost:3002';
  const SESSION_KEY = 'blt_chat_session';
  const BRAND_GOLD = '#c9a96e';
  const BRAND_DARK = '#1a1a1a';

  // Generate or restore session ID
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'blt_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const style = document.createElement('style');
  style.textContent = `
    #blt-chat-bubble {
      position: fixed; bottom: 24px; right: 24px; z-index: 99998;
      width: 56px; height: 56px; border-radius: 50%;
      background: ${BRAND_GOLD}; box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      cursor: pointer; border: none; display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #blt-chat-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
    #blt-chat-bubble svg { width: 26px; height: 26px; fill: #fff; }

    #blt-chat-badge {
      position: absolute; top: -4px; right: -4px;
      width: 18px; height: 18px; border-radius: 50%;
      background: #e53e3e; color: #fff; font-size: 11px; font-weight: 700;
      display: none; align-items: center; justify-content: center;
      font-family: Arial, sans-serif;
    }

    #blt-chat-panel {
      position: fixed; bottom: 90px; right: 24px; z-index: 99999;
      width: 360px; max-width: calc(100vw - 48px);
      height: 520px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.18);
      display: flex; flex-direction: column; overflow: hidden;
      font-family: Arial, sans-serif;
      transform: scale(0.92) translateY(16px); opacity: 0;
      transition: transform 0.22s ease, opacity 0.22s ease;
      pointer-events: none;
    }
    #blt-chat-panel.blt-open {
      transform: scale(1) translateY(0); opacity: 1; pointer-events: all;
    }

    #blt-chat-header {
      background: ${BRAND_DARK}; padding: 14px 16px;
      display: flex; align-items: center; gap: 10px; flex-shrink: 0;
    }
    #blt-chat-header .blt-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      background: ${BRAND_GOLD}; display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    #blt-chat-header .blt-info { flex: 1; }
    #blt-chat-header .blt-name { color: #fff; font-size: 14px; font-weight: 700; }
    #blt-chat-header .blt-status { color: #aaa; font-size: 11px; }
    #blt-chat-header .blt-close {
      background: none; border: none; cursor: pointer; color: #888; font-size: 20px;
      line-height: 1; padding: 0 2px;
    }
    #blt-chat-header .blt-close:hover { color: #fff; }

    #blt-chat-messages {
      flex: 1; overflow-y: auto; padding: 14px 14px 6px;
      display: flex; flex-direction: column; gap: 10px;
    }
    #blt-chat-messages::-webkit-scrollbar { width: 4px; }
    #blt-chat-messages::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }

    .blt-msg { display: flex; align-items: flex-end; gap: 6px; max-width: 88%; }
    .blt-msg.blt-bot { align-self: flex-start; }
    .blt-msg.blt-user { align-self: flex-end; flex-direction: row-reverse; }
    .blt-bubble {
      padding: 9px 13px; border-radius: 16px; font-size: 13px; line-height: 1.45;
      word-break: break-word;
    }
    .blt-bot .blt-bubble {
      background: #f2f2f2; color: #222; border-bottom-left-radius: 4px;
    }
    .blt-user .blt-bubble {
      background: ${BRAND_GOLD}; color: #fff; border-bottom-right-radius: 4px;
    }
    .blt-typing { display: flex; gap: 4px; padding: 10px 13px; }
    .blt-typing span {
      width: 7px; height: 7px; background: #bbb; border-radius: 50%;
      animation: blt-bounce 1.2s infinite;
    }
    .blt-typing span:nth-child(2) { animation-delay: 0.2s; }
    .blt-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes blt-bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }

    #blt-chat-input-row {
      padding: 10px 12px; border-top: 1px solid #eee; display: flex; gap: 8px; flex-shrink: 0;
    }
    #blt-chat-input {
      flex: 1; border: 1px solid #ddd; border-radius: 20px;
      padding: 8px 14px; font-size: 13px; outline: none; resize: none;
      font-family: Arial, sans-serif; line-height: 1.4;
      max-height: 90px; overflow-y: auto;
    }
    #blt-chat-input:focus { border-color: ${BRAND_GOLD}; }
    #blt-chat-send {
      width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
      background: ${BRAND_GOLD}; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    #blt-chat-send:hover { background: #b8924f; }
    #blt-chat-send:disabled { background: #ddd; cursor: default; }
    #blt-chat-send svg { width: 16px; height: 16px; fill: #fff; }

    #blt-lead-saved {
      margin: 0 14px 10px; padding: 8px 12px; background: #f0fdf4;
      border: 1px solid #bbf7d0; border-radius: 8px; font-size: 12px; color: #166534;
      display: none;
    }
  `;
  document.head.appendChild(style);

  // ── HTML ────────────────────────────────────────────────────────────────────

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <button id="blt-chat-bubble" aria-label="Chat with us">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
      <span id="blt-chat-badge">1</span>
    </button>

    <div id="blt-chat-panel" role="dialog" aria-label="Be Li Tailor chat">
      <div id="blt-chat-header">
        <div class="blt-avatar">✂️</div>
        <div class="blt-info">
          <div class="blt-name">Lily · Be Li Tailor</div>
          <div class="blt-status">● Online now</div>
        </div>
        <button class="blt-close" id="blt-close-btn" aria-label="Close chat">×</button>
      </div>
      <div id="blt-chat-messages"></div>
      <div id="blt-lead-saved">✓ Details saved — we'll be in touch within 24 hours!</div>
      <div id="blt-chat-input-row">
        <textarea id="blt-chat-input" rows="1" placeholder="Type a message…" aria-label="Chat message"></textarea>
        <button id="blt-chat-send" aria-label="Send">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  // ── Logic ───────────────────────────────────────────────────────────────────

  const bubble = document.getElementById('blt-chat-bubble');
  const panel = document.getElementById('blt-chat-panel');
  const closeBtn = document.getElementById('blt-close-btn');
  const messages = document.getElementById('blt-chat-messages');
  const input = document.getElementById('blt-chat-input');
  const sendBtn = document.getElementById('blt-chat-send');
  const badge = document.getElementById('blt-chat-badge');
  const leadSaved = document.getElementById('blt-lead-saved');

  let isOpen = false;
  let hasBadge = true;
  let isTyping = false;

  function togglePanel(open) {
    isOpen = open;
    panel.classList.toggle('blt-open', isOpen);
    if (isOpen && hasBadge) {
      badge.style.display = 'none';
      hasBadge = false;
      if (messages.children.length === 0) addBotMessage(
        "Hi! 👋 I'm Lily from Be Li Tailor. How can I help you today? Whether it's a custom suit, alterations, or something special — I'm here!"
      );
    }
    if (isOpen) input.focus();
  }

  bubble.addEventListener('click', () => togglePanel(!isOpen));
  closeBtn.addEventListener('click', () => togglePanel(false));

  // Show badge initially after 3s
  setTimeout(() => {
    if (!isOpen) { badge.style.display = 'flex'; }
  }, 3000);

  function addBotMessage(text) {
    const div = document.createElement('div');
    div.className = 'blt-msg blt-bot';
    div.innerHTML = `<div class="blt-bubble">${escapeHtml(text)}</div>`;
    messages.appendChild(div);
    scrollBottom();
  }

  function addUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'blt-msg blt-user';
    div.innerHTML = `<div class="blt-bubble">${escapeHtml(text)}</div>`;
    messages.appendChild(div);
    scrollBottom();
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'blt-msg blt-bot';
    div.id = 'blt-typing-indicator';
    div.innerHTML = '<div class="blt-bubble blt-typing"><span></span><span></span><span></span></div>';
    messages.appendChild(div);
    scrollBottom();
    return div;
  }

  function removeTyping() {
    document.getElementById('blt-typing-indicator')?.remove();
  }

  function scrollBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isTyping) return;
    input.value = '';
    input.style.height = 'auto';
    addUserMessage(text);
    isTyping = true;
    sendBtn.disabled = true;
    const typingEl = showTyping();

    try {
      const res = await fetch(`${SERVER}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = await res.json();
      removeTyping();
      if (data.error) {
        addBotMessage("Sorry, I'm having a little trouble right now. Please try again in a moment.");
      } else {
        addBotMessage(data.reply);
        if (data.leadSaved && leadSaved.style.display !== 'block') {
          leadSaved.style.display = 'block';
        }
      }
    } catch {
      removeTyping();
      addBotMessage("I seem to be offline at the moment. Please contact us directly or try again shortly.");
    } finally {
      isTyping = false;
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener('click', sendMessage);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 90) + 'px';
  });
})();
