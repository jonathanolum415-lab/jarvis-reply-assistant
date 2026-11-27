const state = {
  mode: 'JARVIS',
  incoming: '',
  voicePhase: 'idle',
  explanation: '',
  replyPending: false,
  turns: [],
  context: []
};

const modes = ['Professional', 'Friendly', 'Funny', 'Short', 'Apologetic', 'Romantic', 'JARVIS'];
const $ = id => document.getElementById(id);
const themeToggle = $('themeToggle');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const storedTheme = (() => {
  try { return localStorage.getItem('jarvis-theme'); } catch { return null; }
})();
let currentTheme = storedTheme === 'light' ? 'light' : 'dark';

function applyTheme(theme, persist = false) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const icon = theme === 'dark'
    ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'
    : '<path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z"/>';
  themeToggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
  themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} mode`);
  themeToggle.title = `Switch to ${nextTheme} mode`;
  themeMeta?.setAttribute('content', theme === 'dark' ? '#111b21' : '#f0f2f5');
  if (persist) {
    try { localStorage.setItem('jarvis-theme', theme); } catch { /* Theme still changes for this visit. */ }
  }
}

applyTheme(currentTheme);
const messageStream = $('messageStream');
const modeGrid = $('modeGrid');
const contextChips = $('contextChips');
const contextSummary = $('contextSummary');
const incomingInput = $('incomingInput');
const voiceButton = $('voiceButton');
const voiceLabel = $('voiceLabel');
const voiceStatus = $('voiceStatus');
const installButton = $('installButton');
const generatingState = $('generatingState');
const apiStatus = $('apiStatus');
const apiStatusDot = $('apiStatusDot');
const toast = $('toast');
const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://jarvisreply-dvh8yfjn.manus.space'
  : '';
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let dictationRecognition = null;
let dictationActive = false;
let deferredInstallPrompt = null;

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function renderMessages() {
  const messages = state.turns.map(turn => {
    if (turn.assistant) {
      return `
        <div class="message assistant-message">
          <div class="message-avatar assistant-avatar">J</div>
          <div class="message-content">
            <div class="message-author">JARVIS <span>assistant</span></div>
            <div class="message-bubble">${escapeHtml(turn.text)}</div>
            <div class="message-time">${escapeHtml(turn.time)}</div>
          </div>
        </div>
      `;
    }
    return `
      <div class="message ${turn.outgoing ? 'outgoing' : ''}">
        <div class="message-avatar ${turn.outgoing ? 'you-avatar' : ''}">${turn.outgoing ? 'Y' : 'J'}</div>
        <div class="message-content">
          <div class="message-author">${escapeHtml(turn.from)}</div>
          <div class="message-bubble">${escapeHtml(turn.text)}</div>
          <div class="message-time">${escapeHtml(turn.time)}</div>
        </div>
      </div>
    `;
  }).join('');
  const typing = state.replyPending ? `
    <div class="message assistant-message typing-message" aria-label="JARVIS is typing">
      <div class="message-avatar assistant-avatar">J</div>
      <div class="message-content">
        <div class="message-author">JARVIS <span>thinking</span></div>
        <div class="typing-indicator"><i></i><i></i><i></i></div>
      </div>
    </div>
  ` : '';
  messageStream.innerHTML = messages + typing;
  messageStream.scrollTop = messageStream.scrollHeight;
}

function renderModes() {
  modeGrid.innerHTML = modes.map((mode, index) => `
    <button class="mode-button ${state.mode === mode ? 'active' : ''}" data-mode="${mode}" aria-pressed="${state.mode === mode}">
      ${String(index + 1).padStart(2, '0')} ${mode}
    </button>
  `).join('');

  modeGrid.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      state.explanation = '';
      generatingState.textContent = 'ready to generate';
      renderModes();
    });
  });
}

function renderContext() {
  contextChips.innerHTML = state.context.map(item => `<span class="context-chip">${escapeHtml(item)}</span>`).join('');
  contextSummary.textContent = state.incoming
    ? 'JARVIS is using the messages in this conversation to understand the current request.'
    : 'Your conversation context will appear here as you add messages.';
  $('turnCount').textContent = `${state.turns.length} turns in working memory`;
}

async function generate() {
  if (state.replyPending) return '';
  const text = incomingInput.value.trim();
  if (!text) {
    showToast('Add an incoming message or use voice input first');
    incomingInput.focus();
    return '';
  }

  state.incoming = text;
  state.turns.push({ from: 'Pasted message', text, time: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date()) });
  state.context.unshift(`latest ask: ${text.slice(0, 28)}${text.length > 28 ? '…' : ''}`);
  state.replyPending = true;
  renderMessages();
  renderContext();
  generatingState.textContent = 'calling managed AI…';
  $('generateButton').disabled = true;
  try {
    const response = await fetch(`${API_BASE}/api/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        mode: state.mode,
        turns: state.turns,
        context: state.context
      })
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'The AI endpoint failed.');
    state.explanation = payload.explanation || '';
    const reply = typeof payload.reply === 'string' ? payload.reply.trim() : '';
    if (!reply) throw new Error('The AI API returned an empty reply. Please try again.');
    state.turns.push({ from: 'JARVIS', text: reply, time: 'now', assistant: true });
    generatingState.textContent = 'live AI response';
    showToast('JARVIS reply ready');
  } catch (error) {
    state.explanation = '';
    generatingState.textContent = 'AI unavailable';
    showToast(error.message || 'The AI API is unavailable. No reply was generated.');
  } finally {
    state.replyPending = false;
    renderMessages();
    $('generateButton').disabled = false;
  }

  return state.turns.findLast(turn => turn.assistant)?.text || '';
}

function stopDictation(message = 'transcript ready · review before sending') {
  dictationActive = false;
  dictationRecognition?.stop();
  voiceButton.classList.remove('listening');
  voiceButton.setAttribute('aria-label', 'Dictate message');
  voiceButton.title = 'Dictate message';
  voiceLabel.textContent = 'Dictate';
  voiceStatus.textContent = message;
}

function startDictation() {
  if (!SpeechRecognition) {
    showToast('Speech input is not supported in this browser. Try a recent version of Safari or Chrome.');
    return;
  }
  if (dictationActive) {
    stopDictation('dictation stopped');
    return;
  }
  dictationRecognition = new SpeechRecognition();
  dictationRecognition.continuous = false;
  dictationRecognition.interimResults = true;
  dictationRecognition.lang = navigator.language || 'en-US';
  dictationActive = true;
  voiceButton.classList.add('listening');
  voiceButton.setAttribute('aria-label', 'Stop dictation');
  voiceButton.title = 'Stop dictation';
  voiceLabel.textContent = 'Listening…';
  voiceStatus.textContent = 'Listening · speak now';
  dictationRecognition.onresult = event => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
    incomingInput.value = transcript;
    incomingInput.dispatchEvent(new Event('input'));
  };
  dictationRecognition.onerror = event => {
    const messages = {
      'not-allowed': 'Microphone permission denied · allow access in browser settings',
      'audio-capture': 'No microphone detected',
      network: 'Speech recognition needs an internet connection'
    };
    stopDictation(messages[event.error] || `Dictation error · ${event.error}`);
  };
  dictationRecognition.onend = () => {
    if (dictationActive) stopDictation();
    else {
      voiceButton.classList.remove('listening');
      voiceLabel.textContent = 'Dictate';
    }
  };
  try {
    dictationRecognition.start();
  } catch (error) {
    stopDictation(error.message || 'Could not start microphone');
  }
}

async function checkApi() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    const payload = await response.json();
    const connected = Boolean(response.ok && payload.aiConfigured);
    apiStatus.textContent = connected ? 'AI service ready' : 'AI service needs server setup';
    apiStatusDot.classList.toggle('connected', connected);
  } catch {
    apiStatus.textContent = 'AI service unavailable';
    apiStatusDot.classList.remove('connected');
  }
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function setupPwa() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  installButton.hidden = isStandalone;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // The app remains fully usable when a browser blocks service workers.
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showToast('Use your browser menu and choose Add to Home Screen');
      return;
    }
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') showToast('JARVIS is being added to your home screen');
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installButton.hidden = true;
    showToast('JARVIS installed — launch it from your home screen');
  });
}

$('generateButton').addEventListener('click', () => generate());
themeToggle.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark', true));
incomingInput.addEventListener('input', () => {
  incomingInput.style.height = 'auto';
  incomingInput.style.height = `${Math.min(incomingInput.scrollHeight, 220)}px`;
});
incomingInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!state.replyPending) generate();
  }
});
voiceButton.addEventListener('click', startDictation);
$('explainButton').addEventListener('click', () => {
  const reason = state.explanation || `JARVIS is using ${state.turns.length} turns, ${state.context.length} context signals, and the ${state.mode} tone.`;
  showToast(reason);
});
$('newThreadButton').addEventListener('click', () => {
  state.turns = [];
  state.context = [];
  state.incoming = '';
  state.replyPending = false;
  state.explanation = '';
  incomingInput.value = '';
  renderMessages();
  renderContext();
  generatingState.textContent = 'new thread';
  showToast('New empty thread ready');
});
setupPwa();
renderMessages();
renderModes();
renderContext();
checkApi();
