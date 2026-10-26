(() => {
    const SUPABASE_URL = 'https://fyywlqohzjdmygnstxvv.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_XxAAd6qaTpKQgTtT0xlLCA_JuLbHxNw';
  const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
  
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const input = $('#messageInput');
  const form = $('#chatForm');
  const sendButton = $('#sendButton');
  const welcome = $('#welcome');
  const messages = $('#messages');
  const chatView = $('#chatView');
  const aboutView = $('#aboutView');
  const sidebar = $('#sidebar');
  let history = [];
  let busy = false;

  function setView(view) {
    const about = view === 'about';
    chatView.classList.toggle('active', !about);
    aboutView.classList.toggle('active', about);
    $('#crumbCurrent').textContent = about ? 'Tentang ExcitementAI' : 'AI Assistant';
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    sidebar.classList.remove('open');
  }
  function startNewChat() {
    if (busy) return;
    history = [];
    messages.innerHTML = '';
    messages.classList.remove('has-messages');
    welcome.hidden = false;
    input.value = '';
    input.focus();
    setView('chat');
  }
  function addMessage(role, text, options = {}) {
    const row = document.createElement('div');
    row.className = `message ${role}${options.error ? ' error' : ''}`;
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'K' : '✦';
    const body = document.createElement('div');
    body.className = 'message-body';
    const name = document.createElement('div');
    name.className = 'message-name';
    name.textContent = role === 'user' ? 'Kamu' : 'ExcitementAI';
    const content = document.createElement('div');
    content.className = 'message-text';
    content.textContent = text;
    body.append(name, content);
    row.append(avatar, body);
    messages.append(row);
    messages.classList.add('has-messages');
    welcome.hidden = true;
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return row;
  }
  function addTyping() {
    const row = addMessage('assistant', '');
    row.querySelector('.message-text').innerHTML = '<div class="typing" aria-label="AI sedang mengetik"><span></span><span></span><span></span></div>';
    return row;
  }
  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }
  async function submitMessage(text) {
    const message = (text ?? input.value).trim();
    if (!message || busy) return;
    setView('chat');
    busy = true;
    sendButton.disabled = true;
    input.value = '';
    resizeInput();
    addMessage('user', message);
    const typing = addTyping();
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history })
      });
      const data = await response.json().catch(() => ({}));
      typing.remove();
      if (!response.ok) {
        addMessage('assistant', data.error || 'Pesan belum bisa diproses. Coba lagi.', { error: true });
      } else {
        addMessage('assistant', data.answer || 'Belum ada jawaban. Coba kirim ulang pesanmu.');
        history.push({ role: 'user', text: message }, { role: 'model', text: data.answer || '' });
        history = history.slice(-12);
      }
    } catch (_error) {
      typing.remove();
      addMessage('assistant', 'Tidak dapat terhubung ke server. Periksa koneksi internet atau coba lagi nanti.', { error: true });
    } finally {
      busy = false;
      sendButton.disabled = false;
      input.focus();
    }
  }
  async function checkHealth() {
    const dot = $('#statusDot');
    const title = $('#statusTitle');
    const sub = $('#statusSub');
    dot.className = 'status-dot';
    title.textContent = 'Memeriksa sistem…';
    sub.textContent = 'Menghubungkan layanan';
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || data.status !== 'ok') throw new Error('health check failed');
      if (data.providerConfigured) {
        dot.className = 'status-dot ok';
        title.textContent = 'Sistem siap';
        sub.textContent = 'Gemini terkonfigurasi';
      } else {
        dot.className = 'status-dot bad';
        title.textContent = 'Setup diperlukan';
        sub.textContent = 'API key Gemini belum diatur';
      }
    } catch (_error) {
      dot.className = 'status-dot bad';
      title.textContent = 'Server belum terhubung';
      sub.textContent = 'Periksa deployment Vercel';
    }
  }

  form.addEventListener('submit', event => { event.preventDefault(); submitMessage(); });
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitMessage(); }
  });
  $$('.prompt-card').forEach(card => card.addEventListener('click', () => submitMessage(card.dataset.prompt)));
  $('#newChat').addEventListener('click', startNewChat);
  $('#mobileMenu').addEventListener('click', () => sidebar.classList.toggle('open'));
  $('#refreshStatus').addEventListener('click', checkHealth);
  $('#aboutButton').addEventListener('click', () => setView('about'));
  $('#backToChat').addEventListener('click', () => setView('chat'));
  $$('.nav-item').forEach(item => item.addEventListener('click', () => setView(item.dataset.view)));
  document.addEventListener('click', event => {
    if (window.innerWidth <= 760 && sidebar.classList.contains('open') && !sidebar.contains(event.target) && !$('#mobileMenu').contains(event.target)) sidebar.classList.remove('open');
  });
  checkHealth();
})();
