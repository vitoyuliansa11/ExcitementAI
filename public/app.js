
(() => {
  'use strict';

  const SUPABASE_URL = 'https://fyywlqohzjdmygnstxvv.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_XxAAd6qaTpKQgTtT0xlLCA_JuLbHxNw';

  const PAYMENT_BUCKET = 'ea-payment-proofs';

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

  // ===== MODE AI =====
  let selectedMode = 'free';

  const modeNames = {
    free: 'Free',
    plus: 'Plus',
    pro_max: 'Pro Max'
  };

  const modeSelectorStyle = document.createElement('style');
  modeSelectorStyle.textContent = `
    #modeSelectorWrapper {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      flex-wrap:wrap;
      padding:11px 13px;
      margin:8px 0;
      border:1px solid var(--border, rgba(128,128,128,.16));
      border-radius:14px;
      background:var(--surface, rgba(120,120,120,.06));
    }

    #modeSelectorWrapper .ea-mode-left {
      display:flex;
      align-items:center;
      gap:10px;
      min-width:0;
    }

    #modeSelectorWrapper .ea-mode-label {
  font-size:13px;
  font-weight:650;
  color:#c4b5fd;
  white-space:nowrap;
}

    #eaModeSelector {
      appearance:none;
      -webkit-appearance:none;
      min-width:120px;
      max-width:100%;
      padding:9px 34px 9px 12px;
      border-radius:10px;
      border:1px solid rgba(167,139,250,.65);
      outline:none;
      background-color:#252044;
      color:#ffffff;
      font:inherit;
      font-size:13px;
      font-weight:600;
      cursor:pointer;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat:no-repeat;
      background-position:right 11px center;
      transition:border-color .2s, background-color .2s;
    }

    #eaModeSelector:hover,
    #eaModeSelector:focus {
      border-color:rgba(129,140,248,.65);
    }

    #eaModeSelector option {
  background:#252044;
  color:#ffffff;
  padding:10px;
}

    #eaModeSelector option[value="free"] {
      color:#cbd5e1;
    }

    #eaModeSelector option[value="plus"] {
      color:#93c5fd;
    }

    #eaModeSelector option[value="pro_max"] {
      color:#c4b5fd;
    }

    #eaUpgradeButton {
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:7px;
      padding:9px 13px;
      border:1px solid rgba(139,92,246,.35);
      border-radius:10px;
      background:linear-gradient(135deg,rgba(99,102,241,.16),rgba(168,85,247,.16));
      color:var(--text,inherit);
      font:inherit;
      font-size:12px;
      font-weight:700;
      cursor:pointer;
      transition:transform .2s,border-color .2s,background .2s;
    }

    #eaUpgradeButton:hover {
      transform:translateY(-1px);
      border-color:rgba(167,139,250,.7);
      background:linear-gradient(135deg,rgba(99,102,241,.24),rgba(168,85,247,.24));
    }

    #eaPaymentOverlay {
      position:fixed;
      inset:0;
      z-index:99999;
      display:none;
      align-items:center;
      justify-content:center;
      padding:18px;
      background:rgba(3,7,18,.76);
      backdrop-filter:blur(9px);
      -webkit-backdrop-filter:blur(9px);
    }

    #eaPaymentOverlay.visible {
      display:flex;
    }

    #eaPaymentModal {
      width:100%;
      max-width:470px;
      max-height:88vh;
      overflow:auto;
      padding:22px;
      border:1px solid rgba(148,163,184,.2);
      border-radius:20px;
      background:#111827;
      color:#f8fafc;
      box-shadow:0 25px 80px rgba(0,0,0,.4);
      animation:eaModalIn .2s ease-out;
    }

    @keyframes eaModalIn {
      from { opacity:0; transform:translateY(10px) scale(.98); }
      to { opacity:1; transform:translateY(0) scale(1); }
    }

    .ea-payment-header {
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:12px;
      margin-bottom:18px;
    }

    .ea-payment-title {
      margin:0;
      font-size:20px;
      font-weight:750;
      letter-spacing:-.4px;
    }

    .ea-payment-close {
      width:34px;
      height:34px;
      border:1px solid rgba(148,163,184,.2);
      border-radius:10px;
      background:rgba(255,255,255,.06);
      color:white;
      font-size:20px;
      cursor:pointer;
    }

    .ea-payment-description {
      margin:0 0 17px;
      color:#aab5c7;
      font-size:13px;
      line-height:1.6;
    }

    .ea-plan-list {
      display:grid;
      gap:12px;
    }

    .ea-plan-card {
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:12px;
      padding:16px;
      border:1px solid rgba(148,163,184,.2);
      border-radius:14px;
      background:rgba(255,255,255,.035);
    }

    .ea-plan-card.plus {
      border-color:rgba(96,165,250,.28);
    }

    .ea-plan-card.pro {
      border-color:rgba(167,139,250,.38);
      background:linear-gradient(120deg,rgba(99,102,241,.10),rgba(168,85,247,.08));
    }

    .ea-plan-name {
      margin:0 0 5px;
      font-size:15px;
      font-weight:750;
    }

    .ea-plan-price {
      margin:0;
      font-size:13px;
      color:#cbd5e1;
    }

    .ea-plan-duration {
      display:block;
      margin-top:4px;
      font-size:11px;
      color:#94a3b8;
    }

    .ea-plan-select {
      flex-shrink:0;
      padding:9px 13px;
      border:0;
      border-radius:9px;
      background:#334155;
      color:white;
      font-size:12px;
      font-weight:700;
      cursor:pointer;
    }

    .ea-plan-card.plus .ea-plan-select {
      background:#2563eb;
    }

    .ea-plan-card.pro .ea-plan-select {
      background:#7c3aed;
    }

    .ea-payment-note {
      margin:16px 0 0;
      color:#94a3b8;
      font-size:11px;
      line-height:1.6;
    }

    .ea-order-box {
      padding:13px;
      margin-bottom:15px;
      border:1px solid rgba(148,163,184,.18);
      border-radius:12px;
      background:rgba(255,255,255,.04);
    }

    .ea-order-row {
      display:flex;
      justify-content:space-between;
      gap:12px;
      padding:5px 0;
      font-size:12px;
    }

    .ea-order-row span:first-child {
      color:#94a3b8;
    }

    .ea-order-row strong {
      text-align:right;
    }

    .ea-qris-image {
      display:block;
      width:min(100%,290px);
      height:auto;
      margin:15px auto;
      padding:9px;
      border-radius:13px;
      background:white;
    }

    .ea-upload-label {
      display:block;
      margin:17px 0 8px;
      color:#e2e8f0;
      font-size:12px;
      font-weight:700;
    }

    #eaProofFile {
      width:100%;
      padding:11px;
      border:1px dashed rgba(148,163,184,.35);
      border-radius:11px;
      background:rgba(255,255,255,.035);
      color:#cbd5e1;
      font-size:12px;
    }

    .ea-payment-primary {
      width:100%;
      margin-top:13px;
      padding:13px;
      border:0;
      border-radius:11px;
      background:linear-gradient(120deg,#4f46e5,#7c3aed);
      color:white;
      font-size:13px;
      font-weight:750;
      cursor:pointer;
    }

    .ea-payment-primary:disabled {
      opacity:.55;
      cursor:not-allowed;
    }

    .ea-payment-secondary {
      width:100%;
      margin-top:9px;
      padding:11px;
      border:1px solid rgba(148,163,184,.2);
      border-radius:11px;
      background:transparent;
      color:#cbd5e1;
      font-size:12px;
      cursor:pointer;
    }

    .ea-payment-status {
      margin-top:12px;
      color:#cbd5e1;
      font-size:12px;
      line-height:1.6;
    }

    .ea-payment-status.error {
      color:#fca5a5;
    }

    .ea-payment-status.success {
      color:#86efac;
    }

    .ea-login-required {
      padding:17px;
      border:1px solid rgba(148,163,184,.2);
      border-radius:13px;
      background:rgba(255,255,255,.04);
      color:#cbd5e1;
      font-size:13px;
      line-height:1.7;
    }

    @media(max-width:520px) {
      #modeSelectorWrapper {
        align-items:stretch;
      }

      #modeSelectorWrapper .ea-mode-left {
        flex:1;
      }

      #eaModeSelector {
        flex:1;
      }

      #eaUpgradeButton {
        width:100%;
      }

      #eaPaymentModal {
        padding:18px;
      }
    }
  `;

  document.head.append(modeSelectorStyle);

  const modeSelectorWrapper = document.createElement('div');
  modeSelectorWrapper.id = 'modeSelectorWrapper';

  const modeLeft = document.createElement('div');
  modeLeft.className = 'ea-mode-left';

  const modeLabel = document.createElement('label');
  modeLabel.className = 'ea-mode-label';
  modeLabel.htmlFor = 'eaModeSelector';
  modeLabel.textContent = 'Mode AI';

  const modeSelector = document.createElement('select');
  modeSelector.id = 'eaModeSelector';
  modeSelector.setAttribute('aria-label', 'Pilih mode AI');

  [
    { value: 'free', label: 'Free' },
    { value: 'plus', label: 'Plus' },
    { value: 'pro_max', label: 'Pro Max' }
  ].forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    modeSelector.append(option);
  });

  modeSelector.value = selectedMode;

  const upgradeButton = document.createElement('button');
  upgradeButton.type = 'button';
  upgradeButton.id = 'eaUpgradeButton';
  upgradeButton.innerHTML = '<span>✦</span><span>Upgrade</span>';

  modeLeft.append(modeLabel, modeSelector);
  modeSelectorWrapper.append(modeLeft, upgradeButton);

  if (form.parentNode) {
    form.parentNode.insertBefore(modeSelectorWrapper, form);
  }

  modeSelector.addEventListener('change', () => {
    selectedMode = modeSelector.value;
  });

  // ===== PAYMENT MODAL =====
  const paymentOverlay = document.createElement('div');
  paymentOverlay.id = 'eaPaymentOverlay';

  const paymentModal = document.createElement('div');
  paymentModal.id = 'eaPaymentModal';
  paymentModal.setAttribute('role', 'dialog');
  paymentModal.setAttribute('aria-modal', 'true');
  paymentModal.setAttribute('aria-labelledby', 'eaPaymentTitle');

  paymentOverlay.append(paymentModal);
  document.body.append(paymentOverlay);

  let currentPaymentOrder = null;
  let paymentBusy = false;

  function setPaymentStatus(message, type = '') {
    const status = $('#eaPaymentStatus');

    if (!status) return;

    status.textContent = message;
    status.className = `ea-payment-status ${type}`.trim();
  }

  function closePaymentModal() {
    if (paymentBusy) return;
    paymentOverlay.classList.remove('visible');
  }

  function openPaymentModal() {
    paymentOverlay.classList.add('visible');
    renderPaymentPlans();
  }

  function renderPaymentHeader() {
    const header = document.createElement('div');
    header.className = 'ea-payment-header';

    const title = document.createElement('h2');
    title.className = 'ea-payment-title';
    title.id = 'eaPaymentTitle';
    title.textContent = 'Upgrade ExcitementAI';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ea-payment-close';
    close.setAttribute('aria-label', 'Tutup');
    close.textContent = '×';
    close.addEventListener('click', closePaymentModal);

    header.append(title, close);
    return header;
  }

  function renderPaymentPlans() {
    paymentModal.replaceChildren();
    paymentModal.append(renderPaymentHeader());

    if (!currentUser) {
      const required = document.createElement('div');
      required.className = 'ea-login-required';
      required.textContent =
        'Kamu perlu login dengan Google terlebih dahulu sebelum membeli paket Plus atau Pro Max.';

      const loginButton = document.createElement('button');
      loginButton.type = 'button';
      loginButton.className = 'ea-payment-primary';
      loginButton.textContent = 'Login dengan Google';
      loginButton.addEventListener('click', async () => {
        closePaymentModal();
        await handleGoogleLogin();
      });

      paymentModal.append(required, loginButton);
      return;
    }

    const description = document.createElement('p');
    description.className = 'ea-payment-description';
    description.textContent =
      'Pilih paket untuk menikmati batas penggunaan yang lebih besar selama satu tahun.';

    const planList = document.createElement('div');
    planList.className = 'ea-plan-list';

    const plans = [
      {
        tier: 'plus',
        name: 'Plus',
        price: 'Rp22.000',
        description: '150 pesan per hari',
        className: 'plus'
      },
      {
        tier: 'pro_max',
        name: 'Pro Max',
        price: 'Rp59.999',
        description: '500 pesan per hari',
        className: 'pro'
      }
    ];

    plans.forEach((plan) => {
      const card = document.createElement('div');
      card.className = `ea-plan-card ${plan.className}`;

      const info = document.createElement('div');

      const name = document.createElement('h3');
      name.className = 'ea-plan-name';
      name.textContent = plan.name;

      const price = document.createElement('p');
      price.className = 'ea-plan-price';
      price.textContent = plan.price;

      const duration = document.createElement('span');
      duration.className = 'ea-plan-duration';
      duration.textContent = `${plan.description} · 1 tahun`;

      info.append(name, price, duration);

      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'ea-plan-select';
      choose.textContent = 'Pilih';
      choose.addEventListener('click', () => createPaymentOrder(plan.tier));

      card.append(info, choose);
      planList.append(card);
    });

    const note = document.createElement('p');
    note.className = 'ea-payment-note';
    note.textContent =
      'Pembayaran menggunakan QRIS DANA. Paket baru aktif setelah pembayaran diperiksa dan disetujui admin.';

    paymentModal.append(description, planList, note);
  }

  async function getCurrentAccessToken() {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) throw error;

    const token = data.session?.access_token;

    if (!token) {
      throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');
    }

    return token;
  }

  async function createPaymentOrder(tier) {
    if (paymentBusy) return;

    paymentBusy = true;
    renderPaymentHeader();

    const loading = document.createElement('p');
    loading.className = 'ea-payment-description';
    loading.textContent = 'Menyiapkan pesanan pembayaran...';
    paymentModal.append(loading);

    try {
      const token = await getCurrentAccessToken();

      const response = await fetch('/api/payment/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        credentials: 'same-origin',
        body: JSON.stringify({ tier })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.code === 'LOGIN_REQUIRED') {
          throw new Error('Silakan login terlebih dahulu.');
        }

        throw new Error(data.error || 'Pesanan gagal dibuat.');
      }

      currentPaymentOrder = data.order;
      renderPaymentCheckout(data.qris_url);
    } catch (error) {
      renderPaymentPlans();
      setPaymentStatus(error.message || 'Gagal membuat pesanan.', 'error');
    } finally {
      paymentBusy = false;
    }
  }

  function renderPaymentCheckout(qrisUrl) {
    paymentModal.replaceChildren();
    paymentModal.append(renderPaymentHeader());

    const order = currentPaymentOrder;
    const planName = modeNames[order.tier] || order.tier;
    const amount = Number(order.amount).toLocaleString('id-ID');

    const description = document.createElement('p');
    description.className = 'ea-payment-description';
    description.textContent =
      'Scan QRIS di bawah menggunakan aplikasi pembayaran. Pastikan nominal sesuai pesanan.';

    const orderBox = document.createElement('div');
    orderBox.className = 'ea-order-box';

    const rows = [
      ['Kode pesanan', order.order_code],
      ['Paket', planName],
      ['Total pembayaran', `Rp${amount}`]
    ];

    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'ea-order-row';

      const left = document.createElement('span');
      left.textContent = label;

      const right = document.createElement('strong');
      right.textContent = value;

      row.append(left, right);
      orderBox.append(row);
    });

    const qr = document.createElement('img');
    qr.className = 'ea-qris-image';
    qr.src = qrisUrl;
    qr.alt = 'QRIS pembayaran ExcitementAI';
    qr.loading = 'eager';

    const instruction = document.createElement('p');
    instruction.className = 'ea-payment-description';
    instruction.textContent =
      'Setelah membayar, unggah screenshot atau foto bukti pembayaran. Format JPG, PNG, atau WebP. Maksimal 5 MB.';

    const uploadLabel = document.createElement('label');
    uploadLabel.className = 'ea-upload-label';
    uploadLabel.htmlFor = 'eaProofFile';
    uploadLabel.textContent = 'Bukti pembayaran';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'eaProofFile';
    fileInput.accept = 'image/jpeg,image/png,image/webp';

    const status = document.createElement('div');
    status.id = 'eaPaymentStatus';
    status.className = 'ea-payment-status';
    status.setAttribute('aria-live', 'polite');

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'ea-payment-primary';
    submit.textContent = 'Kirim Bukti Pembayaran';

    submit.addEventListener('click', () => {
      submitPaymentProof(fileInput, submit);
    });

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ea-payment-secondary';
    back.textContent = 'Kembali ke pilihan paket';
    back.addEventListener('click', () => {
      if (paymentBusy) return;
      currentPaymentOrder = null;
      renderPaymentPlans();
    });

    paymentModal.append(
      description,
      orderBox,
      qr,
      instruction,
      uploadLabel,
      fileInput,
      submit,
      status,
      back
    );
  }

  async function submitPaymentProof(fileInput, submitButton) {
    if (paymentBusy || !currentPaymentOrder) return;

    const file = fileInput.files?.[0];

    if (!file) {
      setPaymentStatus('Pilih gambar bukti pembayaran terlebih dahulu.', 'error');
      return;
    }

    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!allowedTypes.includes(file.type)) {
      setPaymentStatus('Format file harus JPG, PNG, atau WebP.', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
     setPaymentStatus('Ukuran file maksimal 5 MB.', 'error');
      return;
    }

    paymentBusy = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Mengirim bukti...';

    try {
      const token = await getCurrentAccessToken();

      const { data: userData, error: userError } =
        await supabaseClient.auth.getUser();

      if (userError) throw userError;

      const user = userData.user;

      if (!user?.id) {
        throw new Error('Akun tidak ditemukan. Silakan login ulang.');
      }

      const extensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp'
      };

      const extension = extensions[file.type];
      const safeOrderCode = currentPaymentOrder.order_code.replace(
        /[^a-zA-Z0-9_-]/g,
        ''
      );

      const proofPath =
        `${user.id}/${safeOrderCode}-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabaseClient
        .storage
        .from(PAYMENT_BUCKET)
        .upload(proofPath, file, {
          contentType: file.type,
          upsert: false
        });

      if (uploadError) {
        console.error('Proof upload error:', uploadError);
        throw new Error(
          'Upload bukti gagal. Periksa koneksi dan izin Storage.'
        );
      }

      const response = await fetch('/api/payment/proof', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          order_code: currentPaymentOrder.order_code,
          proof_path: proofPath
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Bukti pembayaran gagal dikirim.');
      }

      renderPaymentSuccess();
    } catch (error) {
      console.error('Payment proof error:', error);

      setPaymentStatus(
        error.message || 'Bukti pembayaran gagal dikirim.',
        'error'
      );

      submitButton.disabled = false;
      submitButton.textContent = 'Coba Kirim Lagi';
    } finally {
      paymentBusy = false;
    }
  }

  function renderPaymentSuccess() {
    paymentModal.replaceChildren();
    paymentModal.append(renderPaymentHeader());

    const success = document.createElement('div');
    success.style.cssText =
      'padding:22px 12px;text-align:center;';

    const icon = document.createElement('div');
    icon.textContent = '✓';
    icon.style.cssText =
      'width:58px;height:58px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;background:rgba(34,197,94,.15);color:#86efac;font-size:30px;font-weight:bold;';

    const title = document.createElement('h3');
    title.textContent = 'Bukti berhasil dikirim';
    title.style.cssText = 'margin:0 0 9px;font-size:18px;';

    const description = document.createElement('p');
    description.textContent =
      'Pesanan kamu sedang menunggu pemeriksaan admin. Paket akan aktif setelah pembayaran dikonfirmasi.';
    description.style.cssText =
      'margin:0;color:#aab5c7;font-size:13px;line-height:1.7;';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ea-payment-primary';
    close.textContent = 'Selesai';
    close.addEventListener('click', closePaymentModal);

    success.append(icon, title, description, close);
    paymentModal.append(success);
  }

  upgradeButton.addEventListener('click', openPaymentModal);

  paymentOverlay.addEventListener('click', (event) => {
    if (event.target === paymentOverlay) {
      closePaymentModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      paymentOverlay.classList.contains('visible')
    ) {
      closePaymentModal();
    }
  });

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

    if (!window.marked || !window.DOMPurify) {
      element.textContent = source;
      return;
    }

    try {
      const html = window.marked.parse(source, {
        gfm: true,
        breaks: false
      });

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
      const headers = {
        'Content-Type': 'application/json'
      };

      const { data: sessionData, error: sessionError } =
        await supabaseClient.auth.getSession();

      if (sessionError) throw sessionError;

      const session = sessionData.session;

      if (currentUser && !session?.access_token) {
        throw new Error(
          'Sesi login tidak ditemukan. Silakan login ulang.'
        );
      }

      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          message,
          history,
          mode: selectedMode
        })
      });

      const data = await response.json().catch(() => ({}));

      typing.remove();

      if (!response.ok) {
        if (data.code === 'MODE_NOT_ENTITLED') {
          addMessage(
            'assistant',
            `Mode ${modeNames[selectedMode]} belum aktif di akun kamu. Gunakan tombol Upgrade untuk berlangganan, atau pilih mode lain.`,
            { error: true }
          );
        } else if (data.code === 'LOGIN_REQUIRED') {
          addMessage(
            'assistant',
            'Kamu perlu login terlebih dahulu untuk menggunakan mode Plus atau Pro Max.',
            { error: true }
          );
        } else if (response.status === 429) {
          addMessage(
            'assistant',
            'Batas penggunaan harian untuk mode ini sudah tercapai. Coba lagi besok atau gunakan paket lain.',
            { error: true }
          );
        } else {
          addMessage(
            'assistant',
            data.error || 'Pesan belum bisa diproses. Coba lagi.',
            { error: true }
          );
        }

        return;
      }

      const answer =
        data.answer ||
        'Belum ada jawaban. Coba kirim ulang pesanmu.';

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
    } catch (error) {
      typing.remove();

      console.error('Chat error:', error);

      addMessage(
        'assistant',
        error.message ||
          'Tidak dapat terhubung ke server. Coba lagi nanti.',
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

      if (data.providerConfigured && data.quotaConfigured) {
        dot.className = 'status-dot ok';
        title.textContent = 'Sistem siap';
        sub.textContent = 'Layanan AI dan sistem kuota terkonfigurasi';
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
    const mobileMenuButton = $('#mobileMenu');

    if (
      window.innerWidth <= 760 &&
      sidebar &&
      sidebar.classList.contains('open') &&
      !sidebar.contains(event.target) &&
      !(mobileMenuButton && mobileMenuButton.contains(event.target))
    ) {
      sidebar.classList.remove('open');
    }
  });

  // ===== INITIAL STATE =====
  renderHistoryList();
  resizeInput();
  checkHealth();
})();
