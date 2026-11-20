const state = {
  mode: 'JARVIS',
  incoming: '',
  voicePhase: 'idle',
  selectedDraft: '',
  explanation: '',
  suggestions: [],
  turns: [
    { from: 'Amara', text: 'Hey, are we still on for the study session tomorrow?', time: '18:42' },
    { from: 'You', text: 'Absolutely. I should be free after lunch.', time: '18:44', outgoing: true },
    { from: 'Amara', text: 'Perfect. I found a quiet spot near the library. I can send you the notes too.', time: '18:46' }
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
const generatingState = $('generatingState');
const apiStatus = $('apiStatus');
const toast = $('toast');

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function escapeAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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
    : 'The thread is about a study session tomorrow after lunch. Amara found a quiet library spot and offered to share notes.';
  $('turnCount').textContent = `${state.turns.length} turns in working memory`;
}

async function generate() {
  const text = incomingInput.value.trim();
  if (!text) {
    showToast('Add an incoming message or use voice simulation first');
    incomingInput.focus();
    return;
  }

  state.incoming = text;
  state.turns.push({ from: 'Amara', text, time: '18:49' });
  state.context.unshift(`latest ask: ${text.slice(0, 28)}${text.length > 28 ? '…' : ''}`);
  renderMessages();
  renderContext();
  generatingState.textContent = 'calling managed AI…';
  $('generateButton').disabled = true;

  try {
    const response = await fetch('/api/reply', {
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

async function checkApi() {
  try {
    const response = await fetch('/api/health');
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

$('generateButton').addEventListener('click', generate);
incomingInput.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') generate();
});
voiceButton.addEventListener('click', simulateVoice);
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
renderMessages();
renderModes();
renderSuggestions();
renderContext();
checkApi();
