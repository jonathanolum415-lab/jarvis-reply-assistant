import { handleComposerKeydown } from './keyboard.js';

const state = {
  mode: 'JARVIS',
  incoming: '',
  explanation: '',
  replyPending: false,
  turns: [],
  context: []
};
try { const stored = JSON.parse(localStorage.getItem('jarvis-thread-v1') || 'null'); if (stored && Array.isArray(stored.turns) && Array.isArray(stored.context)) { state.turns = stored.turns.filter(turn => turn && typeof turn === 'object' && typeof turn.text === 'string').slice(-100); state.context = stored.context.filter(item => typeof item === 'string').slice(0,20); } } catch {}

const modes = ['Professional', 'Friendly', 'Funny', 'Short', 'Apologetic', 'Romantic', 'JARVIS'];

const $ = id => document.getElementById(id);
const messageStream = $('messageStream');
const modeGrid = $('modeGrid');
const contextChips = $('contextChips');
const contextSummary = $('contextSummary');
const incomingInput = $('incomingInput');
const voiceInputButton = $('voiceInputButton');
const voiceStatus = $('voiceStatus');
const installButton = $('installButton');
const generatingState = $('generatingState');
const apiStatus = $('apiStatus');
const toast = $('toast');
const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://jarvisreply-dvh8yfjn.manus.space'
  : '';
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isDictating = false;
let deferredInstallPrompt = null;

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function renderMessages() {
  try { localStorage.setItem('jarvis-thread-v1', JSON.stringify({ turns:state.turns.slice(-100), context:state.context.slice(0,20) })); } catch {}
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
    <button class="mode-button ${state.mode === mode ? 'active' : ''}" data-mode="${mode}">
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
  const latest = [...state.turns].reverse().find(turn => !turn.assistant)?.text || '';
  contextSummary.textContent = latest ? 'Context is based on the latest message: “' + latest.slice(0,180) + (latest.length > 180 ? '…' : '') + '” and ' + state.turns.length + ' messages in this thread.' : 'No conversation context yet. Paste an incoming message to begin.';
  $('turnCount').textContent = `${state.turns.length} turns in working memory`;
}

async function generate() {
  const text = incomingInput.value.trim();
  if (state.replyPending) { showToast('JARVIS is already generating a reply.'); return ''; }
  if (!text) {
    showToast('Add or dictate an incoming message first');
    incomingInput.focus();
    return '';
  }

  state.incoming = text;
  state.turns.push({ from: 'Contact', text, time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) });
  state.context.unshift(`latest ask: ${text.slice(0, 28)}${text.length > 28 ? '…' : ''}`);
  state.replyPending = true;
  renderMessages();
  renderContext();
  generatingState.textContent = 'calling managed AI…';
  $('generateButton').disabled = true;
  $('newThreadButton').disabled = true;
  let newReply = '';

  try {
    const response = await fetch(`${API_BASE}/api/reply`, {
      signal: AbortSignal.timeout(20000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        mode: state.mode,
        turns: state.turns.slice(-12),
        context: state.context.slice(0,12)
      })
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'The AI endpoint failed.');
    state.explanation = payload.explanation || '';
    if (typeof payload.reply !== 'string' || !payload.reply.trim()) throw new Error('The AI returned an invalid reply.');
    const reply = payload.reply.trim();
    newReply = reply;
    state.turns.push({ from: 'JARVIS', text: reply, time: 'now', assistant: true });
    generatingState.textContent = 'live AI response';
    showToast('JARVIS reply ready');
  } catch (error) {
    state.explanation = '';
    generatingState.textContent = 'AI unavailable';
    showToast(error.message || 'AI unavailable. No fake reply was substituted.');
  } finally {
    state.replyPending = false;
    renderMessages();
    $('generateButton').disabled = false;
    $('newThreadButton').disabled = false;
  }

  return newReply;
}

function setupVoiceDictation() {
  if (!SpeechRecognition) {
    voiceInputButton.disabled = true;
    voiceInputButton.title = 'Voice typing is not supported in this browser';
    voiceStatus.textContent = 'Voice typing is unavailable here. You can use your device keyboard microphone instead.';
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => {
    isDictating = true;
    voiceInputButton.classList.add('listening');
    voiceInputButton.setAttribute('aria-pressed', 'true');
    voiceInputButton.title = 'Stop voice typing';
    voiceStatus.textContent = 'Listening… speak your message';
  };
  recognition.onresult = event => {
    let finalText = '';
    let interimText = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    if (finalText.trim()) {
      const existing = incomingInput.value.trimEnd();
      incomingInput.value = existing ? `${existing} ${finalText.trim()}` : finalText.trim();
      state.incoming = incomingInput.value;
      renderContext();
      incomingInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    voiceStatus.textContent = interimText ? `Hearing: ${interimText}` : 'Voice text added to the message box';
  };
  recognition.onerror = event => {
    const messages = {
      'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings.',
      'no-speech': 'No speech detected. Tap the microphone and try again.',
      'audio-capture': 'No microphone was found on this device.',
      'network': 'The browser speech service is unavailable. Try again or use keyboard dictation.'
    };
    voiceStatus.textContent = messages[event.error] || `Voice typing stopped: ${event.error}`;
    if (event.error !== 'aborted') showToast(voiceStatus.textContent);
  };
  recognition.onend = () => {
    isDictating = false;
    voiceInputButton.classList.remove('listening');
    voiceInputButton.setAttribute('aria-pressed', 'false');
    voiceInputButton.title = 'Dictate message';
    if (voiceStatus.textContent === 'Listening… speak your message') voiceStatus.textContent = 'Voice typing stopped';
  };
}
function toggleVoiceDictation() {
  if (!recognition) {
    showToast('Voice typing is not supported by this browser. Try your keyboard microphone.');
    return;
  }
  if (isDictating) { recognition.stop(); return; }
  voiceStatus.textContent = 'Starting microphone…';
  try { recognition.start(); }
  catch {
    voiceStatus.textContent = 'Could not start voice typing. Tap the microphone and try again.';
    showToast(voiceStatus.textContent);
  }
}

async function checkApi() {
  try {
    const response = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(10000) });
    const payload = await response.json();
    apiStatus.textContent = payload.aiConfigured ? 'AI endpoint / connected' : 'AI endpoint / needs server config';
  } catch {
    apiStatus.textContent = 'AI endpoint / offline';
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

$('generateButton').addEventListener('click', generate);
incomingInput.addEventListener('keydown', event => handleComposerKeydown(event, generate));
voiceInputButton.addEventListener('click', toggleVoiceDictation);
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


setupVoiceDictation();
setupPwa();
renderMessages();
renderModes();
renderContext();
checkApi();
