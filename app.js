const state = {
  mode: 'JARVIS',
  incoming: '',
  voicePhase: 'idle',
  selectedDraft: '',
  explanation: '',
  replyPending: false,
  turns: [],
  context: []
};
try { const stored = JSON.parse(localStorage.getItem('jarvis-thread-v1') || 'null'); if (stored && Array.isArray(stored.turns) && Array.isArray(stored.context)) { state.turns = stored.turns.slice(-100); state.context = stored.context.slice(0,20); } } catch {}
let savedDrafts = [];
try { savedDrafts = JSON.parse(localStorage.getItem('jarvis-saved-drafts-v1') || '[]'); if (!Array.isArray(savedDrafts)) savedDrafts = []; } catch { savedDrafts = []; }

const modes = ['Professional', 'Friendly', 'Funny', 'Short', 'Apologetic', 'Romantic', 'JARVIS'];

const $ = id => document.getElementById(id);
const messageStream = $('messageStream');
const modeGrid = $('modeGrid');
const contextChips = $('contextChips');
const contextSummary = $('contextSummary');
const incomingInput = $('incomingInput');
const draftEditor = $('draftEditor');
const copyEditedDraft = $('copyEditedDraft');
const saveDraftButton = $('saveDraftButton');
const savedDraftList = $('savedDraftList');
const settingsDialog = $('settingsDialog');
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

function escapeAttr(text) {
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
            <div class="message-author">JARVIS <span>${turn.draft ? 'draft reply' : 'assistant'}</span></div>
            <div class="message-bubble">${escapeHtml(turn.text)}</div>
            ${turn.draft ? `<div class="message-actions"><button class="inline-draft-button use-central-draft" data-text="${escapeAttr(turn.text)}">use as draft</button><button class="inline-draft-button copy-central-draft" data-text="${escapeAttr(turn.text)}">copy</button></div>` : ''}
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
  messageStream.querySelectorAll('.use-central-draft').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedDraft = button.dataset.text;
      draftEditor.value = state.selectedDraft;
      showToast('Draft loaded — review and edit it below');
      button.textContent = 'draft loaded ✓';
    });
  });
  messageStream.querySelectorAll('.copy-central-draft').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.text);
        button.textContent = 'copied ✓';
        showToast('Draft copied to clipboard');
      } catch {
        draftEditor.value = button.dataset.text;
        state.selectedDraft = button.dataset.text;
        button.textContent = 'loaded ✓';
        showToast('Clipboard unavailable — draft loaded for manual copying');
      }
    });
  });
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

function renderSavedDrafts() {
  savedDraftList.replaceChildren();
  if (!savedDrafts.length) { const empty = document.createElement('p'); empty.className = 'empty-suggestions'; empty.textContent = 'No saved drafts yet.'; savedDraftList.append(empty); return; }
  savedDrafts.forEach((draft,index) => {
    const item = document.createElement('div'); item.className = 'saved-draft-item';
    const text = document.createElement('span'); text.textContent = draft.slice(0,80);
    const load = document.createElement('button'); load.className = 'small-button'; load.textContent = 'load'; load.addEventListener('click', () => { draftEditor.value = draft; showToast('Draft loaded into editor.'); });
    const remove = document.createElement('button'); remove.className = 'small-button'; remove.textContent = 'delete'; remove.addEventListener('click', () => { savedDrafts.splice(index,1); localStorage.setItem('jarvis-saved-drafts-v1',JSON.stringify(savedDrafts)); renderSavedDrafts(); });
    item.append(text,load,remove); savedDraftList.append(item);
  });
}

function renderContext() {
  contextChips.innerHTML = state.context.map(item => `<span class="context-chip">${escapeHtml(item)}</span>`).join('');
  const latest = [...state.turns].reverse().find(turn => !turn.assistant)?.text || '';
  contextSummary.textContent = latest ? 'Current context uses the latest message: “' + latest.slice(0,180) + (latest.length > 180 ? '…' : '') + '” and ' + state.turns.length + ' messages in this thread.' : 'No conversation context yet. Paste the incoming message or conversation text to begin';
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
    state.turns.push({ from: 'JARVIS', text: reply, time: 'now', assistant: true, draft: true });
    generatingState.textContent = 'live AI response';
    showToast('JARVIS reply ready — approval still required');
  } catch (error) {
    state.explanation = '';
    generatingState.textContent = 'AI unavailable';
    showToast(error.message || 'AI unavailable. No canned reply was substituted.');
  } finally {
    state.replyPending = false;
    renderMessages();
    $('generateButton').disabled = false;
  }

  const draft = state.turns.findLast(turn => turn.assistant)?.text || '';
  if (speakReply && draft) speakDraft(draft);
  return draft;
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

function speakDraft(text) {
  if (!('speechSynthesis' in window)) {
    setLiveVoiceState('text only', 'browser speech output is unavailable · draft ready for review');
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
  utterance.onstart = () => setLiveVoiceState('speaking', 'JARVIS is reading the draft aloud');
  utterance.onend = () => {
    voiceConversationBusy = false;
    if (liveVoiceActive) beginListening();
    else setLiveVoiceState('paused', 'draft read aloud · nothing was sent');
  };
  utterance.onerror = () => {
    voiceConversationBusy = false;
    setLiveVoiceState('text only', 'draft ready · speech output was interrupted');
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
  setLiveVoiceState('thinking', 'transcript captured · asking managed AI for a draft');
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
  setLiveVoiceState('paused', 'live voice paused · draft mode remains active');
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
    const response = await fetch(`${API_BASE}/api/health`);
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
copyEditedDraft.addEventListener('click', async () => { const text = draftEditor.value.trim(); if (!text) { showToast('Write or load a draft first.'); return; } try { await navigator.clipboard.writeText(text); showToast('Edited draft copied. Nothing was sent.'); } catch { showToast('Clipboard unavailable — select and copy manually.'); } });
saveDraftButton.addEventListener('click', () => { const text = draftEditor.value.trim(); if (!text) { showToast('Write or load a draft first.'); return; } savedDrafts.unshift(text); savedDrafts = savedDrafts.slice(0,50); localStorage.setItem('jarvis-saved-drafts-v1',JSON.stringify(savedDrafts)); renderSavedDrafts(); showToast('Draft saved locally.'); });
$('searchNav').addEventListener('click', () => { const q = prompt('Search this thread:'); if (!q) return; const matches = state.turns.filter(turn => String(turn.text || '').toLowerCase().includes(q.toLowerCase())); showToast(matches.length ? 'Found ' + matches.length + ' matching message(s).' : 'No matches.'); });
$('savedDraftsNav').addEventListener('click', () => savedDraftList.scrollIntoView({behavior:'smooth',block:'center'}));
$('workspaceNav').addEventListener('click', () => { messageStream.scrollTop = messageStream.scrollHeight; });
$('sidebarCollapse').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('collapsed'));
$('clearLocalData').addEventListener('click', () => { localStorage.removeItem('jarvis-thread-v1'); localStorage.removeItem('jarvis-saved-drafts-v1'); state.turns=[]; state.context=[]; savedDrafts=[]; draftEditor.value=''; incomingInput.value=''; settingsDialog.close(); renderMessages(); renderContext(); renderSavedDrafts(); showToast('Local data cleared.'); });

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
  setLiveVoiceState(liveVoiceActive ? 'listening' : 'paused', liveVoiceActive ? 'audio stopped · speak again' : 'draft audio stopped');
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
  draftEditor.value = '';
  state.selectedDraft = '';
  renderMessages();
  renderContext();
  generatingState.textContent = 'new thread';
  showToast('New empty thread ready');
});
$('settingsButton').addEventListener('click', () => settingsDialog.showModal());

setupLiveVoice();
setupPwa();
renderMessages();
renderModes();
renderContext();
renderSavedDrafts();
checkApi();
