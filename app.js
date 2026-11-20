const state = {
  mode: 'JARVIS',
  incoming: '',
  voicePhase: 'idle',
  selectedDraft: '',
  explanation: '',
  suggestions: [],
  turns: [
    { from: 'Jonah', text: 'Hey, are we still on for the study session tomorrow?', time: '18:42' },
    { from: 'You', text: 'Absolutely. I should be free after lunch.', time: '18:44', outgoing: true },
    { from: 'Jonah', text: 'Perfect. I found a quiet spot near the library. I can send you the notes too.', time: '18:46' }
  ],
  context: ['study session tomorrow', 'after lunch', 'quiet spot near library', 'notes available']
};

const modes = ['Professional', 'Friendly', 'Funny', 'Short', 'Apologetic', 'Romantic', 'JARVIS'];
const localReplySets = {
  Professional: [
    'That sounds good. Tomorrow after lunch works for me. I would appreciate the notes as well.',
    'Perfect, thank you. Please send the notes when you have a moment, and I will meet you near the library after lunch.',
    'Confirmed. I will be there after lunch and ready to go through the material.'
  ],
  Friendly: [
    'That sounds perfect! A quiet spot and the notes would be amazing. See you after lunch.',
    'Nice, I’m in. Send the notes whenever you can and I’ll meet you by the library after lunch.',
    'Perfect plan. Thanks for finding a spot — see you tomorrow!'
  ],
  Funny: [
    'A quiet study spot and notes? You have officially made procrastination harder. I’m in.',
    'Deal. After lunch I’ll arrive with energy, questions, and probably too much coffee.',
    'Excellent. The library awaits our academic comeback.'
  ],
  Short: [
    'Perfect, see you after lunch. Send the notes too?',
    'I’m in. See you tomorrow near the library.',
    'Sounds good — see you then.'
  ],
  Apologetic: [
    'Sorry for the slow reply. Tomorrow after lunch still works, and I’d really appreciate the notes.',
    'Apologies, I nearly missed this. The plan sounds good — I’ll meet you after lunch.',
    'Sorry, I got caught up earlier. Thanks for organizing this; I’ll be there.'
  ],
  Romantic: [
    'That sounds lovely. I’d be happy to see you after lunch — send me the notes when you can.',
    'A quiet spot with you sounds like a pretty perfect plan. See you tomorrow.',
    'I’m looking forward to it. Thank you for making the plan so easy.'
  ],
  JARVIS: [
    'Confirmed. Tomorrow, post-meridian. Library vicinity. Notes accepted. I shall arrive prepared.',
    'Your proposal is optimal: quiet location, notes in advance, and a post-lunch rendezvous. Consider it locked.',
    'I have aligned the schedule. Send the notes at your convenience; I will meet you near the library.'
  ]
};

const $ = id => document.getElementById(id);
const messageStream = $('messageStream');
const modeGrid = $('modeGrid');
const suggestions = $('suggestions');
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
const mediaUrl = $('mediaUrl');
const loadMediaButton = $('loadMediaButton');
const mediaPlayer = $('mediaPlayer');
const mediaStatus = $('mediaStatus');
const sourceUrls = $('sourceUrls');
const researchQuestion = $('researchQuestion');
const researchButton = $('researchButton');
const sourceStatus = $('sourceStatus');
const sourceResults = $('sourceResults');
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
  messageStream.innerHTML = state.turns.map(turn => `
    <div class="message ${turn.outgoing ? 'outgoing' : ''}">
      <div>
        <div class="message-bubble">${escapeHtml(turn.text)}</div>
        <div class="message-time">${escapeHtml(turn.from)} · ${escapeHtml(turn.time)}</div>
      </div>
    </div>
  `).join('');
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
      state.suggestions = localReplySets[state.mode];
      state.explanation = '';
      generatingState.textContent = 'ready to generate';
      renderModes();
      renderSuggestions();
    });
  });
}

function renderSuggestions() {
  const current = state.suggestions.length ? state.suggestions : localReplySets[state.mode];
  suggestions.innerHTML = current.map((text, index) => `
    <div class="suggestion-card">
      <p>${escapeHtml(text)}</p>
      <div class="suggestion-actions">
        <button class="small-button explain-single" data-index="${index}">why this</button>
        <button class="small-button use-draft" data-text="${escapeAttr(text)}">use as draft ↗</button>
      </div>
    </div>
  `).join('');

  suggestions.querySelectorAll('.use-draft').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedDraft = button.dataset.text;
      incomingInput.value = state.selectedDraft;
      showToast('Draft loaded — review before approval');
      button.textContent = 'draft loaded ✓';
    });
  });

  suggestions.querySelectorAll('.explain-single').forEach(button => {
    button.addEventListener('click', () => {
      const reason = state.explanation || `This option uses the ${state.mode.toLowerCase()} tone and respects the agreed study-session timing, library location, and notes offer.`;
      showToast(reason);
    });
  });
}

function renderContext() {
  contextChips.innerHTML = state.context.map(item => `<span class="context-chip">${escapeHtml(item)}</span>`).join('');
  contextSummary.textContent = state.incoming
    ? 'JARVIS is tracking the active ask, the agreed timing, and the promise of notes. The latest message is weighted highest while the earlier commitment remains active.'
    : 'The thread is about a study session tomorrow after lunch. Jonah found a quiet library spot and offered to share notes.';
  $('turnCount').textContent = `${state.turns.length} turns in working memory`;
}

async function generate({ speakReply = false } = {}) {
  const text = incomingInput.value.trim();
  if (!text) {
    showToast('Add an incoming message or use voice input first');
    incomingInput.focus();
    return '';
  }

  state.incoming = text;
  state.turns.push({ from: 'Jonah', text, time: '18:49' });
  state.context.unshift(`latest ask: ${text.slice(0, 28)}${text.length > 28 ? '…' : ''}`);
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
    state.suggestions = payload.suggestions;
    state.explanation = payload.explanation || '';
    generatingState.textContent = 'live AI response';
    renderSuggestions();
    showToast('Live AI drafts ready — approval still required');
  } catch (error) {
    state.suggestions = localReplySets[state.mode];
    state.explanation = '';
    generatingState.textContent = 'offline fallback';
    renderSuggestions();
    showToast(error.message || 'The AI endpoint is unavailable; local drafts are shown');
  } finally {
    $('generateButton').disabled = false;
  }

  const draft = state.suggestions[0] || '';
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
  if (handleMediaCommand(cleanTranscript)) return;
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

function mediaEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com')) {
      const id = parsed.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1` : '';
    }
    if (parsed.hostname === 'youtu.be') return `https://www.youtube.com/embed/${encodeURIComponent(parsed.pathname.slice(1))}?autoplay=1`;
    if (parsed.hostname.includes('vimeo.com')) {
      const id = parsed.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}?autoplay=1` : '';
    }
    return '';
  } catch {
    return '';
  }
}

function playMedia(url = mediaUrl.value.trim()) {
  if (!url) {
    mediaStatus.textContent = 'paste a public media URL first';
    mediaUrl.focus();
    return false;
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported URL');
    mediaUrl.value = url;
    const embed = mediaEmbedUrl(url);
    if (embed) {
      mediaPlayer.innerHTML = `<iframe src="${embed}" title="JARVIS media player" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      mediaStatus.textContent = 'embedded media playing · use the player controls';
    } else if (/\.(mp3|wav|ogg|m4a|aac)(\?|#|$)/i.test(parsed.pathname + parsed.search + parsed.hash)) {
      mediaPlayer.innerHTML = `<audio controls autoplay src="${url}"></audio>`;
      mediaStatus.textContent = 'audio playing';
    } else if (/\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(parsed.pathname + parsed.search + parsed.hash)) {
      mediaPlayer.innerHTML = `<video controls autoplay playsinline src="${url}"></video>`;
      mediaStatus.textContent = 'video playing';
    } else {
      mediaPlayer.innerHTML = `<iframe src="${url}" title="JARVIS media player" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      mediaStatus.textContent = 'media loaded · if playback is blocked, open the source directly';
    }
    mediaPlayer.hidden = false;
    return true;
  } catch {
    mediaStatus.textContent = 'use a valid public HTTP(S) media URL';
    return false;
  }
}

function handleMediaCommand(text) {
  const lower = text.toLowerCase();
  const url = text.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.!?]+$/, '');
  if (url && /\b(play|watch|open|listen)\b/.test(lower)) {
    playMedia(url);
    setLiveVoiceState('media', 'media request loaded · voice conversation paused');
    showToast('Media loaded in the JARVIS dock');
    return true;
  }
  if (/\b(stop|pause)\b.*\b(audio|video|media)\b/i.test(text)) {
    mediaPlayer.querySelector('audio, video')?.pause();
    mediaStatus.textContent = 'media paused';
    return true;
  }
  return false;
}

async function researchSources() {
  const urls = sourceUrls.value.split(/\n|,/).map(value => value.trim()).filter(Boolean).slice(0, 5);
  if (!urls.length) {
    sourceStatus.textContent = 'add at least one public URL';
    sourceUrls.focus();
    return;
  }
  researchButton.disabled = true;
  sourceStatus.textContent = 'reading sources and synthesizing…';
  sourceResults.innerHTML = '';
  try {
    const response = await fetch(`${API_BASE}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, question: researchQuestion.value.trim() })
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'Source research failed.');
    sourceResults.innerHTML = `<div class="research-answer"><div class="source-result-label">JARVIS brief</div><p>${escapeHtml(payload.answer).replace(/\n/g, '<br>')}</p></div>${payload.sources.map((source, index) => `<div class="source-card"><span class="source-number">[${index + 1}]</span><div><strong>${escapeHtml(source.title)}</strong><a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">open source ↗</a><p>${escapeHtml(source.excerpt || 'Source unavailable.')}</p></div></div>`).join('')}`;
    sourceStatus.textContent = `${payload.sources.filter(source => source.available).length} sources read · citations ready`;
  } catch (error) {
    sourceStatus.textContent = error.message || 'source reader offline';
  } finally {
    researchButton.disabled = false;
  }
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
loadMediaButton.addEventListener('click', () => playMedia());
mediaUrl.addEventListener('keydown', event => {
  if (event.key === 'Enter') playMedia();
});
researchButton.addEventListener('click', researchSources);
$('explainButton').addEventListener('click', () => {
  const reason = state.explanation || `JARVIS is using ${state.turns.length} turns, ${state.context.length} context signals, and the ${state.mode} tone.`;
  showToast(reason);
});
$('newThreadButton').addEventListener('click', () => {
  state.turns = [];
  state.context = [];
  state.incoming = '';
  state.suggestions = localReplySets[state.mode];
  state.explanation = '';
  incomingInput.value = '';
  renderMessages();
  renderContext();
  renderSuggestions();
  generatingState.textContent = 'new thread';
  showToast('New empty thread ready');
});
$('settingsButton').addEventListener('click', () => showToast('Settings are reserved for the next build'));

state.suggestions = localReplySets[state.mode];
setupLiveVoice();
setupPwa();
renderMessages();
renderModes();
renderSuggestions();
renderContext();
checkApi();
