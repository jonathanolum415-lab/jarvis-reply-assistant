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

  const reply = newReply;
  if (speakReply && reply) speakReplyAloud(reply);
  return reply;
}

let voiceRecorder = null;
let voiceStream = null;
let voiceChunks = [];
let voiceRecordingLive = false;
let voiceRecordingTimer = null;

function chooseAudioMime() {
  const options = ['audio/webm;codecs=opus','audio/webm','audio/mp4'];
  return options.find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
}

async function startVoiceRecording({ live = false } = {}) {
  if (voiceRecorder && voiceRecorder.state === 'recording') return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    voiceCapability.textContent = 'this browser does not support microphone recording';
    setLiveVoiceState('voice unavailable', 'try a supported browser with microphone recording');
    showToast('Microphone recording is not supported by this browser');
    if (live) stopLiveVoice();
    return;
  }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
    const mime = chooseAudioMime();
    voiceChunks = [];
    voiceRecordingLive = live;
    voiceRecorder = mime ? new MediaRecorder(voiceStream,{mimeType:mime}) : new MediaRecorder(voiceStream);
    voiceRecorder.ondataavailable = event => { if (event.data && event.data.size) voiceChunks.push(event.data); };
    voiceRecorder.onerror = () => { cleanupVoiceStream(); showToast('Microphone recording failed'); setLiveVoiceState('mic error','recording failed'); };
    voiceRecorder.onstop = async () => {
      const wasLiveRecording = voiceRecordingLive;
      const recordedMime = voiceRecorder?.mimeType || mime || 'audio/webm';
      const blob = new Blob(voiceChunks,{type:recordedMime});
      cleanupVoiceStream();
      if (wasLiveRecording && !liveVoiceActive) return;
      if (!blob.size) { setLiveVoiceState('no audio','No audio captured. Try again.'); if(liveVoiceActive) startVoiceRecording({live:true}); return; }
      setLiveVoiceState('transcribing','Sending recorded audio for speech recognition');
      try {
        const form = new FormData();
        const ext = recordedMime.includes('mp4') ? 'mp4' : recordedMime.includes('ogg') ? 'ogg' : 'webm';
        form.append('audio',blob,'recording.'+ext);
        const response = await fetch(`${API_BASE}/api/transcribe`,{method:'POST',body:form,signal:AbortSignal.timeout(35000)});
        const result = await response.json().catch(()=>({}));
        if (!response.ok || !result.text) throw new Error(result.error || 'Speech recognition could not transcribe this recording.');
        handleVoiceTranscript(result.text);
      } catch(error) {
        setLiveVoiceState('transcription error',error.message || 'Speech transcription failed');
        showToast(error.message || 'Voice transcription failed');
        voiceConversationBusy = false;
        if (liveVoiceActive) setTimeout(()=>startVoiceRecording({live:true}),500);
      }
    };
    voiceRecorder.start();
    liveVoicePanel.hidden = false;
    if (live) {
      liveVoiceButton.classList.add('listening');
      liveVoiceLabel.textContent = 'pause live voice';
      setLiveVoiceState('listening','Listening for up to 8 seconds; speak now');
      voiceRecordingTimer = setTimeout(()=>{ if(voiceRecorder?.state==='recording') voiceRecorder.stop(); },8000);
    } else {
      voiceButton.classList.add('listening');
      voiceLabel.textContent = 'stop recording';
      voiceStatus.textContent = 'recording · tap stop when finished speaking';
      setLiveVoiceState('recording','Microphone recording in progress');
    }
  } catch(error) {
    cleanupVoiceStream();
    const msg = error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow access in browser settings.' : error.message || 'Unable to access the microphone.';
    voiceCapability.textContent = msg;
    setLiveVoiceState('mic error',msg);
    showToast(msg);
    if(live) stopLiveVoice();
  }
}

function cleanupVoiceStream() {
  if (voiceRecordingTimer) clearTimeout(voiceRecordingTimer);
  voiceRecordingTimer = null;
  if (voiceStream) voiceStream.getTracks().forEach(track=>track.stop());
  voiceStream = null;
  voiceButton.classList.remove('listening');
  voiceLabel.textContent = 'voice input';
  voiceStatus.textContent = '';
}

function startVoiceInput() {
  if (voiceRecorder?.state === 'recording' && !voiceRecordingLive) {
    voiceRecorder.stop();
    return;
  }
  startVoiceRecording({live:false});
}

function setLiveVoiceState(label, status = label) {
  liveVoiceState.textContent = label;
  voiceStatus.textContent = status;
}

function speakReplyAloud(text) {
  if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
    setLiveVoiceState('text only','speech playback is unavailable in this browser · reply shown on screen');
    voiceConversationBusy = false;
    if (liveVoiceActive) startVoiceRecording({live:true});
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 0.96;
  const chooseVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => /en[-_](GB|US)/i.test(v.lang) && /natural|enhanced/i.test(v.name)) || voices.find(v => /^en[-_]/i.test(v.lang));
    if (preferred) utterance.voice = preferred;
  };
  chooseVoice();
  utterance.onstart = () => setLiveVoiceState('speaking','JARVIS is reading the reply aloud');
  utterance.onend = () => {
    voiceConversationBusy = false;
    if (liveVoiceActive) startVoiceRecording({live:true});
    else setLiveVoiceState('paused','reply read aloud');
  };
  utterance.onerror = event => {
    voiceConversationBusy = false;
    setLiveVoiceState('text only',`reply ready · speech synthesis ${event.error || 'failed'}`);
    if (liveVoiceActive) startVoiceRecording({live:true});
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
  setLiveVoiceState('thinking','Transcript captured · generating a reply');
  generate({ speakReply: liveVoiceActive }).finally(() => {
    if (!liveVoiceActive) voiceConversationBusy = false;
    else if (!window.speechSynthesis?.speaking) {
      voiceConversationBusy = false;
      setTimeout(()=>startVoiceRecording({live:true}),500);
    }
  });
}

function beginListening() {
  // Retained as a compatibility stub; microphone input uses MediaRecorder.
}

function stopLiveVoice() {
  liveVoiceActive = false;
  voiceConversationBusy = false;
  if (voiceRecordingTimer) clearTimeout(voiceRecordingTimer);
  voiceRecordingTimer = null;
  if (voiceRecorder?.state === 'recording') { voiceRecorder.stop(); }
  else cleanupVoiceStream();
  window.speechSynthesis?.cancel();
  liveVoiceButton.classList.remove('listening');
  liveVoiceLabel.textContent = 'live voice';
  setLiveVoiceState('paused','live voice paused · reply mode remains active');
}

function startLiveVoice() {
  liveVoiceActive = true;
  liveVoicePanel.hidden = false;
  startVoiceRecording({live:true});
}

function setupLiveVoice() {
  liveVoicePanel.hidden = true;
  const supported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  if (!supported) {
    liveVoiceButton.disabled = true;
    liveVoiceLabel.textContent = 'live voice unavailable';
    voiceButton.disabled = true;
    voiceCapability.textContent = 'microphone recording needs a supported browser and HTTPS';
    return;
  }
  voiceCapability.textContent = 'microphone ready · browser permission required';
  if (!('speechSynthesis' in window)) voiceCapability.textContent += ' · speech output unavailable';
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
voiceButton.addEventListener('click', startVoiceInput);
liveVoiceButton.addEventListener('click', () => {
  if (liveVoiceActive) stopLiveVoice();
  else startLiveVoice();
});
stopSpeakingButton.addEventListener('click', () => {
  window.speechSynthesis?.cancel();
  voiceConversationBusy = false;
  setLiveVoiceState(liveVoiceActive ? 'listening' : 'paused', liveVoiceActive ? 'audio stopped · speak again' : 'reply audio stopped');
  if (liveVoiceActive) startVoiceRecording({live:true});
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


setupLiveVoice();
setupPwa();
renderMessages();
renderModes();
renderContext();
checkApi();
