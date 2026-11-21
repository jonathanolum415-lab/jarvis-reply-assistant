const state = {
  mode: 'JARVIS',
  incoming: '',
  voicePhase: 'idle',
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
const voiceButton = $('voiceButton');
const voiceLabel = $('voiceLabel');
const voiceStatus = $('voiceStatus');
const liveVoiceButton = $('liveVoiceButton');
const liveVoiceLabel = $('liveVoiceLabel');
const liveVoicePanel = $('liveVoicePanel');
const liveVoiceState = $('liveVoiceState');
const stopSpeakingButton = $('stopSpeakingButton');
const voiceCapability = $('voiceCapability');
const installButton = $('installButton');
const generatingState = $('generatingState');
const apiStatus = $('apiStatus');
const toast = $('toast');
const API_BASE = window.location.hostname.endsWith('github.io')
  ? 'https://jarvisreply-dvh8yfjn.manus.space'
  : '';
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let liveVoiceActive = false;
let voiceConversationBusy = false;
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

async function generate({ speakReply = false } = {}) {
  const text = incomingInput.value.trim();
  if (state.replyPending) { showToast('JARVIS is already generating a reply.'); return ''; }
  if (!text) {
    showToast('Add an incoming message or use voice input first');
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
        turns: state.turns,
        context: state.context
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

  const reply = newReply;
  if (speakReply && reply) speakReplyAloud(reply);
  return reply;
}

function simulateVoice() {
  if (state.voicePhase !== 'idle') return;
  state.voicePhase = 'listening';
  voiceButton.classList.add('listening');
  voiceLabel.textContent = 'listening…';
  voiceStatus.textContent = 'voice channel open · speak now';

  setTimeout(() => {
    state.voicePhase = 'processing';
    voiceLabel.textContent = 'processing…';
    voiceStatus.textContent = 'transcribing audio into message context';
    setTimeout(() => {
      state.voicePhase = 'idle';
      const transcript = 'That sounds great. Tomorrow after lunch works for me — please send the notes when you can.';
      incomingInput.value = transcript;
      state.incoming = transcript;
      voiceButton.classList.remove('listening');
      voiceLabel.textContent = 'simulate voice';
      voiceStatus.textContent = 'transcript ready · review before generating';
      renderContext();
      showToast('Voice transcript ready for review');
    }, 900);
  }, 1100);
}

function setLiveVoiceState(label, status = label) {
  liveVoiceState.textContent = label;
  voiceStatus.textContent = status;
}

function speakReplyAloud(text) {
  if (!('speechSynthesis' in window)) {
    setLiveVoiceState('text only', 'browser speech output is unavailable · reply ready');
    voiceConversationBusy = false;
    if (liveVoiceActive) beginListening();
    return;
  }

  recognition?.abort();
  voiceConversationBusy = true;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = .95;
  utterance.onstart = () => setLiveVoiceState('speaking', 'JARVIS is reading the reply aloud');
  utterance.onend = () => {
    voiceConversationBusy = false;
    if (liveVoiceActive) beginListening();
    else setLiveVoiceState('paused', 'reply read aloud');
  };
  utterance.onerror = () => {
    voiceConversationBusy = false;
    setLiveVoiceState('text only', 'reply ready · speech output was interrupted');
    if (liveVoiceActive) beginListening();
  };
  window.speechSynthesis.speak(utterance);
}

function handleVoiceTranscript(transcript) {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript || voiceConversationBusy) return;
  incomingInput.value = cleanTranscript;
  state.incoming = cleanTranscript;
  renderContext();
  voiceConversationBusy = true;
  setLiveVoiceState('thinking', 'transcript captured · asking managed AI for a reply');
  generate({ speakReply: true }).finally(() => {
    if (!('speechSynthesis' in window) || !window.speechSynthesis.speaking) {
      voiceConversationBusy = false;
      if (liveVoiceActive) beginListening();
    }
  });
}

function beginListening() {
  if (!recognition || !liveVoiceActive || voiceConversationBusy) return;
  try {
    recognition.start();
  } catch (error) {
    if (error.name !== 'InvalidStateError') {
      setLiveVoiceState('mic error', 'allow microphone access and try again');
    }
  }
}

function stopLiveVoice() {
  liveVoiceActive = false;
  voiceConversationBusy = false;
  recognition?.stop();
  window.speechSynthesis?.cancel();
  liveVoiceButton.classList.remove('listening');
  liveVoiceLabel.textContent = 'live voice';
  setLiveVoiceState('paused', 'live voice paused · reply mode remains active');
}

function startLiveVoice() {
  if (!recognition) {
    showToast('Live voice needs Chrome or Edge microphone support');
    return;
  }
  liveVoiceActive = true;
  liveVoicePanel.hidden = false;
  liveVoiceButton.classList.add('listening');
  liveVoiceLabel.textContent = 'pause live voice';
  setLiveVoiceState('listening', 'voice channel open · speak naturally');
  beginListening();
}

function setupLiveVoice() {
  liveVoicePanel.hidden = true;
  if (!SpeechRecognition) {
    liveVoiceButton.disabled = true;
    liveVoiceLabel.textContent = 'live voice unavailable';
    voiceCapability.textContent = 'use Chrome or Edge for microphone input';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onstart = () => setLiveVoiceState('listening', 'voice channel open · speak naturally');
  recognition.onresult = event => {
    let interim = '';
    let finalText = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += transcript;
      else interim += transcript;
    }
    if (interim) setLiveVoiceState('listening', `hearing: ${interim}`);
    if (finalText) handleVoiceTranscript(finalText);
  };
  recognition.onerror = event => {
    if (event.error === 'aborted') return;
    const message = event.error === 'not-allowed'
      ? 'microphone permission was denied'
      : `voice channel error · ${event.error}`;
    setLiveVoiceState('mic error', message);
    if (event.error === 'not-allowed') stopLiveVoice();
  };
  recognition.onend = () => {
    if (liveVoiceActive && !voiceConversationBusy) setTimeout(beginListening, 180);
  };
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
incomingInput.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') generate();
});
voiceButton.addEventListener('click', simulateVoice);
liveVoiceButton.addEventListener('click', () => {
  if (liveVoiceActive) stopLiveVoice();
  else startLiveVoice();
});
stopSpeakingButton.addEventListener('click', () => {
  window.speechSynthesis?.cancel();
  voiceConversationBusy = false;
  setLiveVoiceState(liveVoiceActive ? 'listening' : 'paused', liveVoiceActive ? 'audio stopped · speak again' : 'reply audio stopped');
  if (liveVoiceActive) beginListening();
});
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
$('settingsButton').addEventListener('click', () => showToast('Settings are reserved for the next build'));

setupLiveVoice();
setupPwa();
renderMessages();
renderModes();
renderContext();
checkApi();
