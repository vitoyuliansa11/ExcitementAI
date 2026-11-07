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

  let accessState = {
    free: true,
    plus: false,
    pro_max: false
  };

  let selectedMode = 'free';
  let selectedPaymentTier = 'plus';
  let currentPaymentOrder = null;

  try {
    const savedMode = localStorage.getItem('ea_selected_mode');

    if (['free', 'plus', 'pro_max'].includes(savedMode)) {
      selectedMode = savedMode;
    }
  } catch (_) {
    selectedMode = 'free';
  }

  // ==========================================
  // DAILY QUOTA UI
  // ==========================================

  const quotaInfo = document.createElement('div');
  quotaInfo.id = 'quotaInfo';

  quotaInfo.style.cssText = `
    padding: 9px 14px;
    margin: 8px 0;
    border-radius: 10px;
    background: rgba(120,120,120,.09);
    color: inherit;
    font-size: 12px;
    display: none;
  `;

  if (form.parentNode) {
    form.parentNode.insertBefore(quotaInfo, form);
  }

  function updateQuota(quota) {
    if (!quota || !quotaInfo) return;

    const names = {
      guest: 'Guest',
      free: 'Free',
      plus: 'Plus',
      pro_max: 'Pro Max'
    };

    const mode = quota.mode || quota.tier || selectedMode;
    const tier = names[mode] || mode;
    const remaining = Number(quota.remaining);
    const limit = Number(quota.daily_limit);

    const accountLabel = !currentUser && mode === 'free'
      ? 'Guest'
      : tier;

    quotaInfo.textContent =
      `${accountLabel} · ${remaining} dari ${limit} pesan tersisa hari ini`;

    if (quota.allowed === false || remaining <= 0) {
      quotaInfo.textContent += ' · Kuota habis';
      quotaInfo.style.color = '#ef7777';
    } else {
      quotaInfo.style.color = 'inherit';
    }

    quotaInfo.style.display = 'block';
  }

  // ==========================================
  // MODE SELECTOR UI
  // ==========================================

  const modePanel = document.createElement('section');
  modePanel.id = 'eaModePanel';

  modePanel.innerHTML = `
    <div class="ea-mode-heading">
      <div>
        <strong>Mode AI</strong>
        <span>Pilih batas penggunaan harianmu</span>
      </div>

      <button type="button" id="eaRefreshAccess">
        ↻
      </button>
    </div>

    <div class="ea-mode-options">
      <button type="button" class="ea-mode-option" data-mode="free">
        <span class="ea-mode-name">Free</span>
        <span class="ea-mode-limit">45 pesan/hari</span>
        <span class="ea-mode-status"></span>
      </button>

      <button type="button" class="ea-mode-option" data-mode="plus">
        <span class="ea-mode-name">Plus</span>
        <span class="ea-mode-limit">150 pesan/hari</span>
        <span class="ea-mode-status"></span>
      </button>

      <button type="button" class="ea-mode-option" data-mode="pro_max">
        <span class="ea-mode-name">Pro Max</span>
        <span class="ea-mode-limit">500 pesan/hari</span>
        <span class="ea-mode-status"></span>
      </button>
    </div>

    <div class="ea-mode-footer">
      <span id="eaCurrentModeText">Mode aktif: Free</span>
      <button type="button" id="eaOpenPayment">
        Paket & Langganan
      </button>
    </div>
  `;

  if (form.parentNode) {
    form.parentNode.insertBefore(modePanel, form);
  }

  const modeStyles = document.createElement('style');

  modeStyles.textContent = `
    #eaModePanel {
      margin: 10px 0;
      padding: 13px;
      border: 1px solid rgba(140,140,160,.17);
      border-radius: 14px;
      background: rgba(120,120,140,.045);
    }

    .ea-mode-heading,
    .ea-mode-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .ea-mode-heading strong {
      display: block;
      font-size: 13px;
    }

    .ea-mode-heading span {
      display: block;
      margin-top: 3px;
      opacity: .65;
      font-size: 11px;
    }

    #eaRefreshAccess {
      width: 32px;
      height: 32px;
      border: 1px solid rgba(140,140,160,.2);
      border-radius: 9px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 17px;
    }

    .ea-mode-options {
      display: grid;
      grid-template-columns: repeat(3,minmax(0,1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .ea-mode-option {
      min-width: 0;
      padding: 10px 8px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 5px;
      border: 1px solid rgba(140,140,160,.2);
      border-radius: 10px;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color .2s, background .2s, transform .2s;
    }

    .ea-mode-option:hover {
      transform: translateY(-1px);
    }

    .ea-mode-option.active {
      border-color: #7c83ff;
      background: rgba(124,131,255,.12);
    }

    .ea-mode-option.locked {
      opacity: .62;
    }

    .ea-mode-name {
      font-size: 12px;
      font-weight: 700;
    }

    .ea-mode-limit {
      font-size: 10px;
      opacity: .7;
    }

    .ea-mode-status {
      font-size: 9px;
      opacity: .75;
    }

    .ea-mode-footer {
      margin-top: 11px;
      font-size: 10px;
      opacity: .8;
    }

    #eaOpenPayment {
      border: 0;
      border-radius: 8px;
      padding: 8px 11px;
      background: #777cff;
      color: white;
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
    }

    #eaPaymentModal {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(0,0,0,.72);
      backdrop-filter: blur(9px);
    }

    #eaPaymentModal.open {
      display: flex;
    }

    .ea-payment-card {
      width: 100%;
      max-width: 460px;
      max-height: 90vh;
      overflow-y: auto;
      padding: 22px;
      border: 1px solid rgba(150,150,180,.2);
      border-radius: 19px;
      background: #111827;
      color: #f8fafc;
      box-shadow: 0 25px 80px rgba(0,0,0,.4);
    }

    .ea-payment-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }

    .ea-payment-header h2 {
      margin: 0;
      font-size: 20px;
    }

    #eaPaymentClose {
      width: 34px;
      height: 34px;
      border: 1px solid #374151;
      border-radius: 9px;
      background: transparent;
      color: white;
      font-size: 20px;
      cursor: pointer;
    }

    .ea-payment-description {
      color: #aab5c7;
      font-size: 12px;
      line-height: 1.6;
    }

    .ea-payment-plans {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin: 16px 0;
    }

    .ea-payment-plan {
      padding: 14px 10px;
      border: 1px solid #344055;
      border-radius: 12px;
      background: #182338;
      color: white;
      text-align: left;
      cursor: pointer;
    }

    .ea-payment-plan.active {
      border-color: #858aff;
      background: #242a50;
    }

    .ea-payment-plan strong {
      display: block;
      font-size: 14px;
    }

    .ea-payment-plan span {
      display: block;
      margin-top: 7px;
      font-size: 12px;
      color: #c5cbe0;
    }

    .ea-payment-plan small {
      display: block;
      margin-top: 5px;
      color: #9da8bd;
      font-size: 10px;
    }

    .ea-payment-primary {
      width: 100%;
      padding: 13px;
      border: 0;
      border-radius: 10px;
      background: #777cff;
      color: white;
      font-weight: 700;
      cursor: pointer;
    }

    .ea-payment-primary:disabled {
      opacity: .55;
      cursor: wait;
    }

    .ea-payment-secondary {
      width: 100%;
      padding: 12px;
      border: 1px solid #374151;
      border-radius: 10px;
      background: transparent;
      color: white;
      cursor: pointer;
    }

    #eaPaymentProofArea {
      margin-top: 17px;
      padding-top: 16px;
      border-top: 1px solid #344055;
    }

    #eaPaymentQR {
      display: block;
      width: 100%;
      max-width: 250px;
      margin: 12px auto;
      border-radius: 12px;
      background: white;
    }

    #eaPaymentFile {
      display: block;
      width: 100%;
      margin: 12px 0;
      padding: 10px;
      border: 1px solid #344055;
      border-radius: 10px;
      color: white;
      background: #182338;
      font-size: 11px;
    }

    #eaPaymentStatus {
      margin-top: 12px;
      font-size: 12px;
      line-height: 1.6;
      color: #c5cbe0;
      white-space: pre-wrap;
    }

    .ea-payment-note {
      margin-top: 12px;
      color: #9da8bd;
      font-size: 10px;
      line-height: 1.6;
    }

    @media(max-width:480px) {
      .ea-mode-options {
        gap: 5px;
      }

      .ea-mode-option {
        padding: 9px 6px;
      }

      .ea-mode-name {
        font-size: 11px;
      }

      .ea-mode-limit {
        font-size: 9px;
      }

      .ea-payment-card {
        padding: 17px;
      }
    }
  `;

  document.head.append(modeStyles);

  // ==========================================
  // PAYMENT MODAL
  // ==========================================

  const paymentModal = document.createElement('div');

  paymentModal.id = 'eaPaymentModal';

  paymentModal.innerHTML = `
    <div class="ea-payment-card">
      <div class="ea-payment-header">
        <h2>Paket ExcitementAI</h2>
        <button type="button" id="eaPaymentClose">×</button>
      </div>

      <p class="ea-payment-description">
        Pilih paket tahunan. Paket yang berbeda dapat aktif bersamaan.
      </p>

      <div class="ea-payment-plans">
        <button type="button" class="ea-payment-plan active" data-plan="plus">
          <strong>Plus</strong>
          <span>Rp22.000 / tahun</span>
          <small>150 pesan per hari</small>
        </button>

        <button type="button" class="ea-payment-plan" data-plan="pro_max">
          <strong>Pro Max</strong>
          <span>Rp59.999 / tahun</span>
          <small>500 pesan per hari</small>
        </button>
      </div>

      <button type="button" class="ea-payment-primary" id="eaCreateOrder">
        Buat pesanan
      </button>

      <div id="eaPaymentProofArea" hidden>
        <p class="ea-payment-description">
          Transfer menggunakan QRIS DANA Bisnis di bawah ini.
        </p>

        <img id="eaPaymentQR" alt="QRIS DANA Bisnis">

        <p id="eaPaymentOrderCode"></p>
        <p id="eaPaymentAmount"></p>

        <label for="eaPaymentFile">
          Upload bukti pembayaran (JPG, PNG, atau WebP)
        </label>

        <input
          type="file"
          id="eaPaymentFile"
          accept="image/jpeg,image/png,image/webp"
        >

        <button
          type="button"
          class="ea-payment-primary"
          id="eaSubmitProof"
        >
          Kirim bukti pembayaran
        </button>
      </div>

      <p id="eaPaymentStatus"></p>

      <p class="ea-payment-note">
        Pesanan berlaku 24 jam. Paket baru aktif setelah pembayaran
        diperiksa dan disetujui oleh administrator.
      </p>
    </div>
  `;

  document.body.append(paymentModal);

  const paymentClose = $('#eaPaymentClose');
  const paymentStatus = $('#eaPaymentStatus');
  const paymentProofArea = $('#eaPaymentProofArea');
  const paymentQR = $('#eaPaymentQR');
  const paymentOrderCode = $('#eaPaymentOrderCode');
  const paymentAmount = $('#eaPaymentAmount');
  const paymentFile = $('#eaPaymentFile');
  const createOrderButton = $('#eaCreateOrder');
  const submitProofButton = $('#eaSubmitProof');

  function setPaymentStatus(message, isError = false) {
    paymentStatus.textContent = message;
    paymentStatus.style.color = isError ? '#ff8b8b' : '#c5cbe0';
  }

  function formatRupiah(value) {
    return `Rp${Number(value).toLocaleString('id-ID')}`;
  }

  function selectPaymentTier(tier) {
    if (!['plus', 'pro_max'].includes(tier)) return;

    selectedPaymentTier = tier;

    $$('.ea-payment-plan').forEach((button) => {
      button.classList.toggle(
        'active',
        button.dataset.plan === tier
      );
    });
  }

  function openPaymentModal(tier = 'plus') {
    if (!currentUser) {
      showAuthMessage('Login terlebih dahulu untuk berlangganan.');
      return;
    }

    currentPaymentOrder = null;
    paymentProofArea.hidden = true;
    paymentFile.value = '';
    createOrderButton.hidden = false;
    createOrderButton.disabled = false;
    createOrderButton.textContent = 'Buat pesanan';

    selectPaymentTier(tier);
    setPaymentStatus('');

    paymentModal.classList.add('open');
  }

  function closePaymentModal() {
    paymentModal.classList.remove('open');
  }

  paymentClose.addEventListener('click', closePaymentModal);

  paymentModal.addEventListener('click', (event) => {
    if (event.target === paymentModal) {
      closePaymentModal();
    }
  });

  $$('.ea-payment-plan').forEach((button) => {
    button.addEventListener('click', () => {
      selectPaymentTier(button.dataset.plan);
    });
  });

  $('#eaOpenPayment').addEventListener('click', () => {
    openPaymentModal('plus');
  });

  // ==========================================
  // AUTH HELPERS
  // ==========================================

  async function getAccessToken() {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) throw error;

    return data.session?.access_token || null;
  }

  async function authenticatedFetch(url, options = {}) {
    const token = await getAccessToken();

    if (!token) {
      throw new Error('Sesi login tidak ditemukan. Login ulang.');
    }

    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    };

    return fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin'
    });
  }

  // ==========================================
  // PAYMENT: CREATE ORDER
  // ==========================================

  async function createPaymentOrder() {
    if (!currentUser) {
      setPaymentStatus('Login terlebih dahulu.', true);
      return;
    }

    createOrderButton.disabled = true;
    createOrderButton.textContent = 'Membuat pesanan...';

    setPaymentStatus('Sedang membuat pesanan...');

    try {
      const response = await authenticatedFetch(
        '/api/payments/orders',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            tier: selectedPaymentTier
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Gagal membuat pesanan.');
      }

      currentPaymentOrder = data.order;

      paymentQR.src = data.qrisImage;

      paymentOrderCode.textContent =
        `Kode pesanan: ${data.order.order_code}`;

      paymentAmount.textContent =
        `Total pembayaran: ${formatRupiah(data.order.amount)}`;

      paymentProofArea.hidden = false;
      createOrderButton.hidden = true;

      setPaymentStatus(
        'Pesanan berhasil dibuat. Scan QRIS, lakukan pembayaran, lalu upload bukti transfer.'
      );

    } catch (error) {
      console.error('Create order error:', error);

      setPaymentStatus(
        error.message || 'Gagal membuat pesanan.',
        true
      );

      createOrderButton.disabled = false;
      createOrderButton.textContent = 'Coba lagi';

    } finally {
      if (!currentPaymentOrder) {
        createOrderButton.disabled = false;
      }
    }
  }

  createOrderButton.addEventListener('click', createPaymentOrder);

  // ==========================================
  // PAYMENT: UPLOAD PROOF
  // ==========================================

  async function submitPaymentProof() {
    if (!currentUser || !currentPaymentOrder) {
      setPaymentStatus('Buat pesanan terlebih dahulu.', true);
      return;
    }

    const file = paymentFile.files?.[0];

    if (!file) {
      setPaymentStatus('Pilih gambar bukti pembayaran.', true);
      return;
    }

    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!allowedTypes.includes(file.type)) {
      setPaymentStatus(
        'Format file harus JPG, PNG, atau WebP.',
        true
      );
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setPaymentStatus(
        'Ukuran file maksimal 5 MB.',
        true
      );
      return;
    }

    submitProofButton.disabled = true;
    submitProofButton.textContent = 'Mengirim bukti...';

    setPaymentStatus('Mengupload bukti pembayaran...');

    try {
      const extensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp'
      };

      const randomId =
        window.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const filePath =
        `${currentUser.id}/` +
        `${currentPaymentOrder.order_code}-` +
        `${randomId}.${extensions[file.type]}`;

      const { error: uploadError } = await supabaseClient
        .storage
        .from(PAYMENT_BUCKET)
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      setPaymentStatus(
        'Bukti berhasil diupload. Mengirim untuk verifikasi...'
      );

      const response = await authenticatedFetch(
        '/api/payments/submit-proof',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            order_code: currentPaymentOrder.order_code,
            proof_path: filePath
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || 'Gagal mengirim bukti pembayaran.'
        );
      }

      setPaymentStatus(
        '✓ Bukti pembayaran berhasil dikirim!\n\n' +
        'Pesanan sedang menunggu pemeriksaan administrator. ' +
        'Paket akan aktif setelah pembayaran benar-benar diverifikasi.'
      );

      submitProofButton.hidden = true;
      paymentFile.disabled = true;

    } catch (error) {
      console.error('Submit payment proof error:', error);

      setPaymentStatus(
        error.message ||
        'Gagal mengirim bukti pembayaran. Coba lagi.',
        true
      );

      submitProofButton.disabled = false;
      submitProofButton.textContent = 'Coba kirim lagi';

    } finally {
      if (!submitProofButton.hidden) {
        submitProofButton.disabled = false;
      }
    }
  }

  submitProofButton.addEventListener('click', submitPaymentProof);

  // ==================
