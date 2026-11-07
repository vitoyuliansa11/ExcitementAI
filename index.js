
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

const {
  GROQ_API_KEY,
  GROQ_MODEL,
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY,
  GUEST_TOKEN_SECRET,
  RESEND_API_KEY,
  APP_URL
} = process.env;

const COOKIE_NAME = 'ea_guest';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const ALLOWED_MODES = new Set(['free', 'plus', 'pro_max']);

const PAYMENT_BUCKET = 'ea-payment-proofs';
const PAYMENT_ADMIN_EMAIL = 'vitoyu­liansa11@gmail.com'.replace(/\u00AD/g, '');
const PAYMENT_QRIS_URL =
  'https://i.ibb.co.com/tt5G9Fk/qr-ID1026480172745-07-11-26-1794041989-1794041989405.jpg';

const PAYMENT_PLANS = {
  plus: {
    amount: 22000,
    name: 'Plus'
  },
  pro_max: {
    amount: 59999,
    name: 'Pro Max'
  }
};

function getCookie(req, name) {
  const cookies = (req.headers.cookie || '').split(';');

  for (const cookie of cookies) {
    const index = cookie.indexOf('=');
    if (index < 0) continue;

    const key = cookie.slice(0, index).trim();

    if (key === name) {
      return cookie.slice(index + 1).trim();
    }
  }

  return null;
}

function signGuestId(id) {
  return crypto
    .createHmac('sha256', GUEST_TOKEN_SECRET)
    .update(id)
    .digest('hex');
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function getGuestId(req) {
  const value = getCookie(req, COOKIE_NAME);
  if (!value) return null;

  const separator = value.lastIndexOf('.');
  if (separator < 0) return null;

  const id = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  if (!/^[a-f0-9]{48}$/.test(id)) return null;

  const expected = signGuestId(id);

  return safeEqual(signature, expected) ? id : null;
}

function setGuestCookie(res, id) {
  const value = `${id}.${signGuestId(id)}`;

  const cookie = [
    `${COOKIE_NAME}=${value}`,
    `Max-Age=${COOKIE_MAX_AGE}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(process.env.NODE_ENV === 'production' || process.env.VERCEL
      ? ['Secure']
      : [])
  ].join('; ');

  res.append('Set-Cookie', cookie);
}

async function verifySupabaseUser(accessToken) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) return null;

  const user = await response.json();

  if (!user || typeof user.id !== 'string') return null;

  return user;
}

async function getAuthenticatedUser(req) {
  const authorization = req.headers.authorization || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  if (!bearerMatch) return null;

  return verifySupabaseUser(bearerMatch[1]);
}

async function consumeQuota({ userId, guestId, mode }) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/ea_consume_daily_quota_for_mode`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
      },
      body: JSON.stringify({
        p_user_id: userId || null,
        p_guest_key: guestId || null,
        p_mode: mode
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage = String(
      result?.message ||
      result?.details ||
      result?.hint ||
      result?.error ||
      ''
    );

    if (errorMessage.includes('MODE_NOT_ENTITLED')) {
      const error = new Error('MODE_NOT_ENTITLED');
      error.code = 'MODE_NOT_ENTITLED';
      throw error;
    }

    console.error('Supabase quota error:', response.status, result);
    throw new Error('QUOTA_SERVICE_ERROR');
  }

  const quota = Array.isArray(result) ? result[0] : result;

  if (!quota || typeof quota.allowed !== 'boolean') {
    throw new Error('INVALID_QUOTA_RESPONSE');
  }

  return quota;
}

// ===== SUPABASE ADMIN REST =====
async function supabaseAdminRequest(table, options = {}) {
  const {
    method = 'GET',
    query = '',
    body,
    prefer
  } = options;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        ...(prefer ? { Prefer: prefer } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000)
    }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    console.error('Supabase admin REST error:', {
      table,
      status: response.status,
      result
    });

    throw new Error('SUPABASE_ADMIN_REQUEST_FAILED');
  }

  return result;
}

function createOrderCode() {
  return `EA-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function hashApprovalToken(token) {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

function getAppUrl(req) {
  if (APP_URL) return APP_URL.replace(/\/+$/, '');

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return `${req.protocol}://${req.get('host')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function sendPaymentReviewEmail({
  order,
  user,
  token,
  req
}) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_NOT_CONFIGURED');
  }

  const reviewUrl =
    `${getAppUrl(req)}/api/payment/review?token=${encodeURIComponent(token)}`;

  const plan = PAYMENT_PLANS[order.tier];
  const customerEmail = user.email || 'Tidak tersedia';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#202124">
      <div style="padding:24px;border-radius:16px;background:#111827;color:white">
        <h1 style="margin:0 0 8px">ExcitementAI</h1>
        <p style="margin:0;color:#cbd5e1">Permintaan verifikasi pembayaran baru</p>
      </div>

      <div style="padding:24px">
        <h2>Pesanan ${escapeHtml(order.order_code)}</h2>
        <p>Ada pengguna yang mengirim bukti pembayaran langganan.</p>

        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:10px;border-bottom:1px solid #eee">Paket</td>
            <td style="padding:10px;border-bottom:1px solid #eee"><b>${escapeHtml(plan.name)}</b></td>
          </tr>
          <tr>
            <td style="padding:10px;border-bottom:1px solid #eee">Jumlah</td>
            <td style="padding:10px;border-bottom:1px solid #eee"><b>Rp${plan.amount.toLocaleString('id-ID')}</b></td>
          </tr>
          <tr>
            <td style="padding:10px;border-bottom:1px solid #eee">Email pengguna</td>
            <td style="padding:10px;border-bottom:1px solid #eee">${escapeHtml(customerEmail)}</td>
          </tr>
          <tr>
            <td style="padding:10px;border-bottom:1px solid #eee">Status</td>
            <td style="padding:10px;border-bottom:1px solid #eee">Menunggu pemeriksaan</td>
          </tr>
        </table>

        <p style="margin-top:24px">
          Buka halaman pemeriksaan untuk melihat detail pesanan dan menyetujui atau menolak pembayaran.
        </p>

        <a href="${escapeHtml(reviewUrl)}"
          style="display:inline-block;padding:13px 20px;border-radius:10px;background:#2563eb;color:white;text-decoration:none;font-weight:bold">
          Periksa Pembayaran
        </a>

        <p style="margin-top:24px;color:#6b7280;font-size:12px">
          Pastikan dana benar-benar masuk ke DANA Business sebelum menyetujui pesanan.
          Tautan ini berlaku selama 48 jam.
        </p>
      </div>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'ExcitementAI <onboarding@resend.dev>',
      to: [PAYMENT_ADMIN_EMAIL],
      subject: `Verifikasi pembayaran ${order.order_code} — ${plan.name}`,
      html,
      text:
        `Pesanan ${order.order_code}\n` +
        `Paket: ${plan.name}\n` +
        `Jumlah: Rp${plan.amount}\n` +
        `Email pengguna: ${customerEmail}\n` +
        `Periksa pembayaran: ${reviewUrl}\n\n` +
        'Pastikan dana sudah masuk ke DANA Business sebelum menyetujui.'
    }),
    signal: AbortSignal.timeout(20000)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('Resend error:', response.status, result);
    throw new Error('EMAIL_SEND_FAILED');
  }

  return result;
}

// ===== PAYMENT: CREATE ORDER =====
app.post('/api/payment/orders', async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPABASE_PUBLISHABLE_KEY) {
      return res.status(503).json({
        error: 'Konfigurasi pembayaran belum lengkap.'
      });
    }

    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'Login terlebih dahulu untuk berlangganan.',
        code: 'LOGIN_REQUIRED'
      });
    }

    const tier = String(req.body?.tier || '').trim().toLowerCase();
    const plan = PAYMENT_PLANS[tier];

    if (!plan) {
      return res.status(400).json({
        error: 'Paket langganan tidak valid.'
      });
    }

    const orderCode = createOrderCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const inserted = await supabaseAdminRequest('ea_payment_orders', {
      method: 'POST',
      query: 'select=id,order_code,tier,amount,status,expires_at',
      prefer: 'return=representation',
      body: {
        order_code: orderCode,
        user_id: user.id,
        tier,
        amount: plan.amount,
        currency: 'IDR',
        status: 'pending',
        expires_at: expiresAt
      }
    });

    const order = Array.isArray(inserted) ? inserted[0] : inserted;

    if (!order) {
      throw new Error('ORDER_CREATION_FAILED');
    }

    return res.status(201).json({
      order: {
        order_code: order.order_code,
        tier: order.tier,
        amount: order.amount,
        status: order.status,
        expires_at: order.expires_at
      },
      qris_url: PAYMENT_QRIS_URL
    });
  } catch (error) {
    console.error('Create payment order error:', error.message);

    return res.status(500).json({
      error: 'Pesanan belum bisa dibuat. Coba lagi nanti.'
    });
  }
});

// ===== PAYMENT: SUBMIT PROOF =====
app.post('/api/payment/proof', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'Login terlebih dahulu.',
        code: 'LOGIN_REQUIRED'
      });
    }

    const orderCode = String(req.body?.order_code || '').trim();
    const proofPath = String(req.body?.proof_path || '').trim();

    if (!orderCode || !proofPath) {
      return res.status(400).json({
        error: 'Data pesanan atau bukti pembayaran belum lengkap.'
      });
    }

    if (
      proofPath.length > 500 ||
      proofPath.includes('..') ||
      !proofPath.startsWith(`${user.id}/`)
    ) {
      return res.status(400).json({
        error: 'Lokasi bukti pembayaran tidak valid.'
      });
    }

    const query = new URLSearchParams({
      select: 'id,order_code,user_id,tier,amount,status,expires_at',
      order_code: `eq.${orderCode}`,
      user_id: `eq.${user.id}`,
      limit: '1'
    }).toString();

    const rows = await supabaseAdminRequest('ea_payment_orders', { query });
    const order = Array.isArray(rows) ? rows[0] : null;

    if (!order) {
      return res.status(404).json({
        error: 'Pesanan tidak ditemukan.'
      });
    }

    if (order.status !== 'pending') {
      return res.status(409).json({
        error: 'Pesanan ini sudah pernah mengirim bukti atau sudah diproses.'
      });
    }

    if (new Date(order.expires_at).getTime() < Date.now()) {
      await supabaseAdminRequest('ea_payment_orders', {
        method: 'PATCH',
        query: `order_code=eq.${encodeURIComponent(orderCode)}&user_id=eq.${user.id}`,
        body: { status: 'expired' }
      });

      return res.status(410).json({
        error: 'Pesanan sudah kedaluwarsa. Buat pesanan baru.'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashApprovalToken(token);
    const tokenExpiresAt =
      new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await supabaseAdminRequest('ea_payment_orders', {
      method: 'PATCH',
      query: `order_code=eq.${encodeURIComponent(orderCode)}&user_id=eq.${user.id}&status=eq.pending`,
      body: {
        status: 'review',
        proof_path: proofPath,
        approval_token_hash: tokenHash,
        approval_token_expires_at: tokenExpiresAt
      }
    });

    try {
      await sendPaymentReviewEmail({
        order,
        user,
        token,
        req
      });
    } catch (emailError) {
      console.error('Payment review email error:', emailError.message);

      await supabaseAdminRequest('ea_payment_orders', {
        method: 'PATCH',
        query: `order_code=eq.${encodeURIComponent(orderCode)}&user_id=eq.${user.id}&status=eq.review`,
        body: {
          status: 'pending',
          proof_path: null,
          approval_token_hash: null,
          approval_token_expires_at: null
        }
      }).catch((rollbackError) => {
        console.error('Payment rollback error:', rollbackError.message);
      });

      return res.status(502).json({
        error: 'Bukti tersimpan, tetapi email verifikasi gagal dikirim. Coba kirim ulang beberapa saat lagi.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Bukti pembayaran berhasil dikirim. Pesanan menunggu pemeriksaan admin.'
    });
  } catch (error) {
    console.error('Submit payment proof error:', error.message);

    return res.status(500).json({
      error: 'Bukti pembayaran belum bisa diproses. Coba lagi nanti.'
    });
  }
});

// ===== PAYMENT: ADMIN REVIEW PAGE =====
app.get('/api/payment/review', async (req, res) => {
  try {
    const token = String(req.query.token || '');

    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).send('Tautan verifikasi tidak valid.');
    }

    const tokenHash = hashApprovalToken(token);
    const query = new URLSearchParams({
      select: 'order_code,tier,amount,status,approval_token_expires_at',
      approval_token_hash: `eq.${tokenHash}`,
      limit: '1'
    }).toString();

    const rows = await supabaseAdminRequest('ea_payment_orders', { query });
    const order = Array.isArray(rows) ? rows[0] : null;

    if (
      !order ||
      order.status !== 'review' ||
      !order.approval_token_expires_at ||
      new Date(order.approval_token_expires_at).getTime() < Date.now()
    ) {
      return res.status(410).send('Tautan sudah kedaluwarsa atau pesanan sudah diproses.');
    }

    const plan = PAYMENT_PLANS[order.tier];

    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    return res.send(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verifikasi Pembayaran — ExcitementAI</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:24px;background:#0b1020;color:#f8fafc;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh}
main{width:100%;max-width:480px;padding:28px;border:1px solid #293449;border-radius:20px;background:#111827}
h1{margin-top:0}
p{color:#cbd5e1;line-height:1.6}
.info{padding:14px;background:#1e293b;border-radius:12px;margin:20px 0}
.info div{display:flex;justify-content:space-between;gap:12px;padding:8px 0}
button{width:100%;padding:14px;border:0;border-radius:10px;font-size:15px;font-weight:bold;cursor:pointer;margin-top:10px}
.approve{background:#16a34a;color:white}
.reject{background:#dc2626;color:white}
small{color:#94a3b8}
</style>
</head>
<body>
<main>
<h1>Verifikasi Pembayaran</h1>
<p>Periksa transaksi masuk DANA Business terlebih dahulu. Jangan menyetujui hanya berdasarkan gambar bukti.</p>
<div class="info">
<div><span>Order</span><b>${escapeHtml(order.order_code)}</b></div>
<div><span>Paket</span><b>${escapeHtml(plan.name)}</b></div>
<div><span>Jumlah</span><b>Rp${plan.amount.toLocaleString('id-ID')}</b></div>
<div><span>Status</span><b>Menunggu pemeriksaan</b></div>
</div>
<form method="POST" action="/api/payment/review">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button class="approve" name="action" value="approve">Setujui & Aktifkan Paket</button>
<button class="reject" name="action" value="reject">Tolak Pembayaran</button>
</form>
<p><small>Persetujuan akan mengaktifkan paket selama satu tahun. Pastikan nominal dan transaksi sudah cocok.</small></p>
</main>
</body>
</html>`);
  } catch (error) {
    console.error('Payment review page error:', error.message);
    return res.status(500).send('Halaman verifikasi gagal dimuat.');
  }
});

// ===== PAYMENT: ADMIN REVIEW ACTION =====
app.post(
  '/api/payment/review',
  express.urlencoded({ extended: false, limit: '10kb' }),
  async (req, res) => {
    try {
      const token = String(req.body?.token || '');
      const action = String(req.body?.action || '');

      if (!/^[a-f0-9]{64}$/.test(token) || !['approve', 'reject'].includes(action)) {
        return res.status(400).send('Permintaan tidak valid.');
      }

      const tokenHash = hashApprovalToken(token);
      const query = new URLSearchParams({
        select: 'id,order_code,user_id,tier,amount,status,approval_token_expires_at',
        approval_token_hash: `eq.${tokenHash}`,
        limit: '1'
      }).toString();

      const rows = await supabaseAdminRequest('ea_payment_orders', { query });
      const order = Array.isArray(rows) ? rows[0] : null;

      if (
        !order ||
        order.status !== 'review' ||
        !order.approval_token_expires_at ||
        new Date(order.approval_token_expires_at).getTime() < Date.now()
      ) {
        return res.status(410).send('Pesanan sudah diproses atau tautan kedaluwarsa.');
      }

      if (action === 'reject') {
        await supabaseAdminRequest('ea_payment_orders', {
          method: 'PATCH',
          query: `id=eq.${encodeURIComponent(order.id)}&status=eq.review`,
          body: {
            status: 'rejected',
            approval_token_hash: null,
            approval_token_expires_at: null
          }
        });

        return res.send(
          '<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pembayaran Ditolak</title><body style="font-family:Arial;background:#111827;color:white;padding:40px;text-align:center"><h1>Pembayaran ditolak</h1><p>Pesanan telah ditandai sebagai ditolak.</p></body></html>'
        );
      }

      const now = new Date();
      const entitlementQuery = new URLSearchParams({
        select: 'user_id,tier,status,starts_at,expires_at',
        user_id: `eq.${order.user_id}`,
        tier: `eq.${order.tier}`,
        limit: '1'
      }).toString();

      const existingRows = await supabaseAdminRequest(
        'ea_user_entitlements',
        { query: entitlementQuery }
      );

      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      const oldExpiry = existing?.expires_at
        ? new Date(existing.expires_at)
        : null;

      const stillActive =
        existing &&
        existing.status === 'active' &&
        oldExpiry &&
        oldExpiry.getTime() > now.getTime();

      const startsAt = stillActive && existing.starts_at
        ? existing.starts_at
        : now.toISOString();

      const baseDate = stillActive ? oldExpiry : now;
      const expiresAt = new Date(
        baseDate.getTime() + 365 * 24 * 60 * 60 * 1000
      ).toISOString();

      await supabaseAdminRequest('ea_user_entitlements', {
        method: 'POST',
        query: 'on_conflict=user_id,tier',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: {
          user_id: order.user_id,
          tier: order.tier,
          status: 'active',
          starts_at: startsAt,
          expires_at: expiresAt
        }
      });

      await supabaseAdminRequest('ea_payment_orders', {
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(order.id)}&status=eq.review`,
        body: {
          status: 'paid',
          paid_at: now.toISOString(),
          verified_at: now.toISOString(),
          approval_token_hash: null,
          approval_token_expires_at: null
        }
      });

      return res.send(
        '<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paket Aktif</title><body style="font-family:Arial;background:#111827;color:white;padding:40px;text-align:center"><h1>Pembayaran disetujui!</h1><p>Paket pengguna telah diaktifkan selama satu tahun.</p></body></html>'
      );
    } catch (error) {
      console.error('Payment review action error:', error.message);

      return res.status(500).send(
        'Terjadi kesalahan saat memproses pesanan. Periksa log server sebelum mencoba lagi.'
      );
    }
  }
);

// HEALTH CHECK DAN DIAGNOSTIK
app.get('/api/health', (_req, res) => {
  const envCheck = {
    groq: Boolean(process.env.GROQ_API_KEY),
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
    supabasePublishableKey: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY),
    supabaseSecretKey: Boolean(process.env.SUPABASE_SECRET_KEY),
    guestTokenSecret: Boolean(process.env.GUEST_TOKEN_SECRET),
    resend: Boolean(process.env.RESEND_API_KEY)
  };

  const providerConfigured = envCheck.groq;

  const quotaConfigured =
    envCheck.supabaseUrl &&
    envCheck.supabasePublishableKey &&
    envCheck.supabaseSecretKey &&
    envCheck.guestTokenSecret;

  res.status(200).json({
    status: 'ok',
    app: 'ExcitementAI',
    version: '2.4.0',
    provider: 'Groq',
    providerConfigured,
    quotaConfigured,
    paymentConfigured: Boolean(
      envCheck.supabaseUrl &&
      envCheck.supabaseSecretKey &&
      envCheck.resend
    ),
    configured: providerConfigured && quotaConfigured,
    diagnostics: envCheck,
    timestamp: new Date().toISOString()
  });
});

// CHAT API
app.post('/api/chat', async (req, res) => {
  try {
    if (
      !GROQ_API_KEY ||
      !SUPABASE_URL ||
      !SUPABASE_PUBLISHABLE_KEY ||
      !SUPABASE_SECRET_KEY ||
      !GUEST_TOKEN_SECRET
    ) {
      return res.status(503).json({
        error: 'Konfigurasi server belum lengkap. Hubungi administrator.'
      });
    }

    const body = req.body || {};

    const message =
      typeof body.message === 'string'
        ? body.message.trim()
        : '';

    const history = Array.isArray(body.history)
      ? body.history
      : [];

    const mode = typeof body.mode === 'string'
      ? body.mode.trim().toLowerCase()
      : 'free';

    if (!message) {
      return res.status(400).json({
        error: 'Pesan tidak boleh kosong.'
      });
    }

    if (message.length > 12000) {
      return res.status(413).json({
        error: 'Pesan terlalu panjang. Coba ringkas pesanmu.'
      });
    }

    if (!ALLOWED_MODES.has(mode)) {
      return res.status(400).json({
        error: 'Mode AI tidak valid.'
      });
    }

    // VERIFIKASI LOGIN SUPABASE
    const authorization = req.headers.authorization || '';
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

    let user = null;

    if (authorization && !bearerMatch) {
      return res.status(401).json({
        error: 'Format autentikasi tidak valid.'
      });
    }

    if (bearerMatch) {
      try {
        user = await verifySupabaseUser(bearerMatch[1]);
      } catch (error) {
        console.error('Auth verification error:', error.message);

        return res.status(503).json({
          error: 'Gagal memverifikasi login. Coba lagi.'
        });
      }

      if (!user) {
        return res.status(401).json({
          error: 'Sesi login tidak valid atau sudah kedaluwarsa.'
        });
      }
    }

    // IDENTITAS GUEST
    let guestId = null;

    if (!user) {
      if (mode !== 'free') {
        return res.status(403).json({
          error: 'Login terlebih dahulu untuk menggunakan mode berlangganan.',
          code: 'LOGIN_REQUIRED'
        });
      }

      guestId = getGuestId(req);

      if (!guestId) {
        guestId = crypto.randomBytes(24).toString('hex');
        setGuestCookie(res, guestId);
      }
    }

    // KONSUMSI KUOTA BERDASARKAN MODE YANG DIPILIH
    let quota;

    try {
      quota = await consumeQuota({
        userId: user ? user.id : null,
        guestId,
        mode
      });
    } catch (error) {
      if (error.code === 'MODE_NOT_ENTITLED') {
        return res.status(403).json({
          error: 'Paket kamu belum memiliki akses ke mode ini. Silakan berlangganan atau pilih mode lain.',
          code: 'MODE_NOT_ENTITLED',
          mode
        });
      }

      console.error('Quota error:', error.message);

      return res.status(503).json({
        error: 'Sistem kuota sedang bermasalah. Coba lagi nanti.'
      });
    }

    if (!quota.allowed) {
      return res.status(429).json({
        error: 'Kuota harian kamu untuk mode ini sudah habis.',
        quota
      });
    }

    // IDENTITAS RESMI EXCITEMENTAI
    const messages = [{
      role: 'system',
      content: `
Kamu adalah ExcitementAI, asisten AI yang ramah, cerdas,
profesional, jujur, jelas, dan membantu.

IDENTITAS RESMI:

- Nama produk: ExcitementAI
- Founder: Alfryza Vito Yuliansa
- Creator: Alfryza Vito Yuliansa
- Jabatan: Founder & Creator of ExcitementAI

ATURAN IDENTITAS:

1. Jika pengguna bertanya siapa founder, creator,
   pencipta, atau pendiri ExcitementAI, jawab:
   "Founder & Creator ExcitementAI adalah Alfryza Vito Yuliansa."
2. Jangan mengarang informasi pribadi founder.
3. Jangan mengubah identitas resmi tersebut.
4. Jawab sesuai bahasa pengguna.
5. Jika tidak mengetahui sesuatu, katakan dengan jujur.

ATURAN UMUM:

- Berikan jawaban yang jelas dan mudah dipahami.
- Bersikap ramah, sopan, dan profesional.
- Jangan mengarang fakta.
- Bantu pengguna sesuai kebutuhan mereka.
      `
    }];

    for (const item of history.slice(-12)) {
      if (!item || typeof item.text !== 'string') continue;

      const role = item.role === 'model' ? 'assistant' : item.role;

      if (!['user', 'assistant'].includes(role)) continue;

      const text = item.text.trim().slice(0, 12000);

      if (text) {
        messages.push({ role, content: text });
      }
    }

    messages.push({
      role: 'user',
      content: message
    });

    const model = (
      GROQ_MODEL || 'llama-3.3-70b-versatile'
    ).trim();

    // REQUEST KE GROQ
    const upstream = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_completion_tokens: 2048
        }),
        signal: AbortSignal.timeout(45000)
      }
    );

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const status = upstream.status;
      const detail = data?.error?.message || 'No upstream message';

      console.error('Groq API error:', status, detail);

      if (status === 401 || status === 403) {
        return res.status(502).json({
          error: 'Groq menolak API key atau akses akun.'
        });
      }

      if (status === 429) {
        return res.status(502).json({
          error: 'Layanan Groq sedang mencapai batas penggunaan.'
        });
      }

      return res.status(502).json({
        error: 'Layanan Groq sedang bermasalah. Coba lagi nanti.'
      });
    }

    const answer = data?.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return res.status(502).json({
        error: 'Groq tidak mengirim jawaban. Coba kirim ulang.'
      });
    }

    return res.status(200).json({
      answer,
      model,
      quota
    });
  } catch (error) {
    if (
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError'
    ) {
      return res.status(504).json({
        error: 'Permintaan terlalu lama. Coba lagi nanti.'
      });
    }

    console.error('Chat route error:', error?.message || error);

    return res.status(500).json({
      error: 'Terjadi kesalahan di server. Coba lagi.'
    });
  }
});

// API YANG TIDAK DITEMUKAN
app.use('/api', (_req, res) => {
  res.status(404).json({
    error: 'Endpoint API tidak ditemukan.'
  });
});

// HALAMAN WEBSITE
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();

  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ERROR HANDLER
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      error: 'Format JSON tidak valid.'
    });
  }

  console.error('Unhandled server error:', err?.message || err);

  return res.status(500).json({
    error: 'Terjadi kesalahan server.'
  });
});

// LOCAL SERVER
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ExcitementAI ready at http://localhost:${PORT}`);
  });
}

module.exports = app;
