
(() => {
  'use strict';

  const SUPABASE_URL = 'https://fyywlqohzjdmygnstxvv.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_XxAAd6qaTpKQgTtT0xlLCA_JuLbHxNw';

  if (!window.supabase) {
    console.error('Supabase library gagal dimuat.');
    return;
  }

  const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  // ===== ELEMENTS =====
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
  const chatHistoryList = $('#chatHistoryList');

  if (!input || !form || !sendButton || !messages || !welcome) {
    console.error('Elemen utama chat tidak ditemukan di index.html.');
    return;
  }

  // ===== STATE =====
  let history = [];
  let activeMessages = [];
  let currentConversationId = null;
  let currentUser = null;
  let cachedConversations = [];
  let busy = false;
  let loadingHistory = false;

  // ===== AUTH UI =====
  const googleLoginButton = $('#googleLoginButton');
  const googleLoginLabel = $('#googleLoginLabel');
  const authMessage = $('#authMessage');
  const profileAvatar = $('#profileAvatar');
  const profileName = $('#profileName');
  const profileEmail = $('#profileEmail');

  function showAuthMessage(message) {
    if (!authMessage) return;

    authMessage.textContent = message;
    authMessage.classList.toggle('visible', Boolean(message));
  }

  function updateProfile(user) {
    if (!user) {
      if (profileName) profileName.textContent = 'Pengunjung';
      if (profileEmail) profileEmail.textContent = 'Belum masuk';
      if (profileAvatar) profileAvatar.textContent = 'K';

      if (googleLoginLabel) {
        googleLoginLabel.textContent = 'Masuk dengan Google';
      }

      return;
    }

    const name =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'Pengguna';

    if (profileName) profileName.textContent = name;
    if (profileEmail) profileEmail.textContent = user.email || '';

    if (profileAvatar) {
      profileAvatar.textContent = name.charAt(0).toUpperCase();
    }

    if (googleLoginLabel) {
      googleLoginLabel.textContent = 'Keluar';
    }
  }

  async function handleGoogleLogin() {
    if (!googleLoginButton) return;

    googleLoginButton.disabled = true;
    showAuthMessage('Menghubungkan...');

    try {
      const { data, error: sessionError } =
        await supabaseClient.auth.getSession();

      if (sessionError) throw sessionError;

      if (data.session) {
        const { error } = await supabaseClient.auth.signOut();

        if (error) throw error;

        showAuthMessage('Kamu sudah keluar.');
        return;
      }

      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });

      if (error) throw error;
    } catch (error) {
      console.error('Login error:', error);
      showAuthMessage(error.message || 'Login gagal. Coba lagi.');
    } finally {
      googleLoginButton.disabled = false;
    }
  }

  if (googleLoginButton) {
    googleLoginButton.addEventListener('click', handleGoogleLogin);
  }

  // ===== NAVIGATION =====
  function setView(view) {
    const about = view === 'about';

    if (chatView) chatView.classList.toggle('active', !about);
    if (aboutView) aboutView.classList.toggle('active', about);

    const crumb = $('#crumbCurrent');

    if (crumb) {
      crumb.textContent = about ? 'Tentang ExcitementAI' : 'AI Assistant';
    }

    $$('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === view);
    });

    if (sidebar) sidebar.classList.remove('open');
  }

  // ===== SAFE MARKDOWN RENDERING =====
  function renderMarkdown(element, text) {
    const source = String(text ?? '');

    // Jika CDN gagal, tampilkan teks biasa tanpa menjalankan HTML.
    if (!window.marked || !window.DOMPurify) {
      element.textContent = source;
      return;
    }

    try {
      const html = window.marked.parse(source, {
        gfm: true,
        breaks: false
      });

      // Sanitasi hasil parser sebelum dimasukkan ke DOM.
      element.innerHTML = window.DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true }
      });
    } catch (error) {
      console.error('Markdown rendering error:', error);
      element.textContent = source;
    }
  }

  // ===== MESSAGE DISPLAY =====
  function addMessage(role, text, options = {}) {
    const row = document.createElement('div');

    // Class yang benar untuk styling pesan user dan assistant.
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

    if (role === 'assistant') {
      renderMarkdown(content, text);
    } else {
      content.textContent = String(text ?? '');
    }

    body.append(name, content);
    row.append(avatar, body);
    messages.append(row);

    messages.classList.add('has-messages');
    welcome.hidden = true;

    row.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });

    return row;
  }

  function addTyping() {
    const row = addMessage('assistant', '');

    // Indikator mengetik statis; tidak memproses konten dari pengguna.
    const textElement = row.querySelector('.message-text');

    textElement.innerHTML =
      '<div class="typing" aria-label="AI sedang mengetik">' +
      '<span></span><span></span><span></span></div>';

    return row;
  }

  function clearDisplayedMessages() {
    messages.replaceChildren();
    messages.classList.remove('has-messages');
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  // ===== CHAT HISTORY LIST =====
  function renderHistoryList() {
    if (!chatHistoryList) return;

    chatHistoryList.replaceChildren();

    if (!currentUser) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'Login untuk menyimpan riwayat chat.';
      chatHistoryList.append(empty);
      return;
    }

    if (cachedConversations.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'Belum ada riwayat chat.';
      chatHistoryList.append(empty);
      return;
    }

    cachedConversations.forEach((conversation) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';

      if (conversation.id === currentConversationId) {
        button.classList.add('active');
      }

      const icon = document.createElement('span');
      icon.className = 'history-item-icon';
      icon.textContent = '◷';

      const title = document.createElement('span');
      title.className = 'history-item-title';
      title.textContent = conversation.title || 'Percakapan baru';
      title.title = conversation.title || 'Percakapan baru';

      button.append(icon, title);

      button.addEventListener('click', () => {
        openConversation(conversation.id);
      });

      chatHistoryList.append(button);
    });
  }

  async function loadChatHistory() {
    if (!currentUser || loadingHistory) return;

    loadingHistory = true;

    try {
      const { data, error } = await supabaseClient
        .from('chat_conversations')
        .select('id, title, messages, created_at, updated_at')
        .eq('user_id', currentUser.id)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      cachedConversations = data || [];
      renderHistoryList();
    } catch (error) {
      console.error('Gagal memuat riwayat:', error);

      showAuthMessage(
        'Riwayat belum bisa dimuat. Periksa konfigurasi Supabase.'
      );
    } finally {
      loadingHistory = false;
    }
  }

  // ===== OPEN OLD CONVERSATION =====
  async function openConversation(conversationId) {
    if (busy) return;

    if (!currentUser) {
      showAuthMessage('Login untuk membuka riwayat chat.');
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from('chat_conversations')
        .select('id, title, messages')
        .eq('id', conversationId)
        .eq('user_id', currentUser.id)
        .single();

      if (error) throw error;

      currentConversationId = data.id;

      const savedMessages = Array.isArray(data.messages)
        ? data.messages
        : [];

      activeMessages = savedMessages
        .filter((item) =>
          ['user', 'assistant'].includes(item.role) &&
          typeof item.text === 'string'
        )
        .map((item) => ({
          role: item.role,
          text: item.text
        }));

      history = activeMessages.map((item) => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        text: item.text
      })).slice(-12);

      clearDisplayedMessages();

      if (activeMessages.length === 0) {
        welcome.hidden = false;
      } else {
        activeMessages.forEach((item) => {
          // Pesan lama juga dirender sebagai Markdown.
          addMessage(item.role, item.text);
        });
      }

      input.value = '';
      resizeInput();
      setView('chat');
      renderHistoryList();
      showAuthMessage('');
    } catch (error) {
      console.error('Gagal membuka percakapan:', error);
      showAuthMessage('Percakapan gagal dibuka. Coba lagi.');
    }
  }

  // ===== NEW CHAT =====
  function startNewChat() {
    if (busy) return;

    history = [];
    activeMessages = [];
    currentConversationId = null;

    clearDisplayedMessages();
    welcome.hidden = false;

    input.value = '';
    resizeInput();

    renderHistoryList();
    setView('chat');
    input.focus();
  }

  // ===== SAVE CONVERSATION =====
  async function saveConversation() {
    if (!currentUser || activeMessages.length === 0) return;

    const firstUserMessage = activeMessages.find(
      (item) => item.role === 'user'
    );

    const title = (
      firstUserMessage?.text || 'Percakapan baru'
    ).replace(/\s+/g, ' ').trim().slice(0, 65);

    const payload = {
      user_id: currentUser.id,
      title: title || 'Percakapan baru',
      messages: activeMessages,
      updated_at: new Date().toISOString()
    };

    try {
      if (currentConversationId) {
        const { error } = await supabaseClient
          .from('chat_conversations')
          .update({
            title: payload.title,
            messages: payload.messages,
            updated_at: payload.updated_at
          })
          .eq('id', currentConversationId)
          .eq('user_id', currentUser.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabaseClient
          .from('chat_conversations')
          .insert(payload)
          .select('id')
          .single();

        if (error) throw error;

        currentConversationId = data.id;
      }

      await loadChatHistory();
      renderHistoryList();
      showAuthMessage('');
    } catch (error) {
      console.error('Gagal menyimpan percakapan:', error);

      showAuthMessage(
        'Pesan terkirim, tetapi riwayat gagal disimpan. Coba lagi nanti.'
      );
    }
  }

  // ===== SEND MESSAGE TO AI =====
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
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          history
        })
      });

      const data = await response.json().catch(() => ({}));

      typing.remove();

      if (!response.ok) {
        addMessage(
          'assistant',
          data.error || 'Pesan belum bisa diproses. Coba lagi.',
          { error: true }
        );
      } else {
        const answer =
          data.answer || 'Belum ada jawaban. Coba kirim ulang pesanmu.';

        addMessage('assistant', answer);

        history.push(
          { role: 'user', text: message },
          { role: 'model', text: answer }
        );

        history = history.slice(-12);

        activeMessages.push(
          { role: 'user', text: message },
          { role: 'assistant', text: answer }
        );

        if (currentUser) {
          await saveConversation();
        }
      }
    } catch (error) {
      typing.remove();

      console.error('Chat error:', error);

      addMessage(
        'assistant',
        'Tidak dapat terhubung ke server. Periksa koneksi internet atau coba lagi nanti.',
        { error: true }
      );
    } finally {
      busy = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  // ===== SYSTEM HEALTH =====
  async function checkHealth() {
    const dot = $('#statusDot');
    const title = $('#statusTitle');
    const sub = $('#statusSub');

    if (!dot || !title || !sub) return;

    dot.className = 'status-dot';
    title.textContent = 'Memeriksa sistem…';
    sub.textContent = 'Menghubungkan layanan';

    try {
      const response = await fetch('/api/health', {
        cache: 'no-store'
      });

      const data = await response.json();

      if (!response.ok || data.status !== 'ok') {
        throw new Error('Health check gagal');
      }

      if (data.providerConfigured) {
        dot.className = 'status-dot ok';
        title.textContent = 'Sistem siap';
        sub.textContent = 'Layanan AI terkonfigurasi';
      } else {
        dot.className = 'status-dot bad';
        title.textContent = 'Setup diperlukan';
        sub.textContent = 'Konfigurasi AI belum lengkap';
      }
    } catch (error) {
      console.error('Health check error:', error);

      dot.className = 'status-dot bad';
      title.textContent = 'Server belum terhubung';
      sub.textContent = 'Periksa deployment Vercel';
    }
  }

  // ===== AUTH SESSION =====
  async function applySession(session) {
    currentUser = session?.user || null;
    updateProfile(currentUser);

    if (currentUser) {
      await loadChatHistory();
    } else {
      cachedConversations = [];
      renderHistoryList();
    }
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    // Hindari menjalankan operasi Supabase langsung di callback auth.
    setTimeout(() => {
      applySession(session).catch((error) => {
        console.error('Gagal memperbarui sesi:', error);
      });
    }, 0);
  });

  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (error) {
      showAuthMessage('Gagal memeriksa sesi login.');
      return;
    }

    applySession(data.session).catch((sessionError) => {
      console.error('Gagal memuat sesi:', sessionError);
    });
  });

  // ===== EVENT LISTENERS =====
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitMessage();
  });

  input.addEventListener('input', resizeInput);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  });

  $$('.prompt-card').forEach((card) => {
    card.addEventListener('click', () => {
      submitMessage(card.dataset.prompt);
    });
  });

  const newChatButton = $('#newChat');
  if (newChatButton) {
    newChatButton.addEventListener('click', startNewChat);
  }

  const mobileMenu = $('#mobileMenu');
  if (mobileMenu && sidebar) {
    mobileMenu.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  const refreshStatus = $('#refreshStatus');
  if (refreshStatus) {
    refreshStatus.addEventListener('click', checkHealth);
  }

  const aboutButton = $('#aboutButton');
  if (aboutButton) {
    aboutButton.addEventListener('click', () => setView('about'));
  }

  const backToChat = $('#backToChat');
  if (backToChat) {
    backToChat.addEventListener('click', () => setView('chat'));
  }

  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      setView(item.dataset.view);
    });
  });

  document.addEventListener('click', (event) => {
    if (
      window.innerWidth <= 760 &&
      sidebar &&
      sidebar.classList.contains('open') &&
      !sidebar.contains(event.target) &&
      !($('#mobileMenu') || document.createElement('div')).contains(event.target)
    ) {
      sidebar.classList.remove('open');
    }
  });

  // ===== INITIAL STATE =====
  renderHistoryList();
  resizeInput();
  checkHealth();
})();
      
