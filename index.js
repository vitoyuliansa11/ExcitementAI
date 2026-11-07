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
  RESEND_API_KEY
} = process.env;

const COOKIE_NAME = 'ea_guest';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const ADMIN_EMAIL = 'vitoyuliansa11@gmail.com';
const RESEND_FROM = 'ExcitementAI <onboarding@resend.dev>';
const APP_URL = 'https://excitement-ai-groq.vercel.app';
const QRIS_IMAGE =
  'https://i.ibb.co.com/tt5G9Fk/qr-ID1026480172745-07-11-26-1794041989-1794041989405.jpg';

const PAYMENT_BUCKET = 'ea-payment-proofs';

const PLANS = {
  plus: {
    name: 'Plus',
    amount: 22000
  },
  pro_max: {
    name: 'Pro Max',
    amount: 59999
  }
};

// ==========================================
// GENERAL HELPERS
// ==========================================

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSupabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    ...extra
  };
}

async function adminRequest(resource, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${resource}`,
    {
      method: options.method || 'GET',
      headers: getSupabaseHeaders({
        'Content-Type': 'application/json',
        ...(options.prefer ? { Prefer: options.prefer } : {}),
        ...(options.headers || {})
      }),
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      signal: AbortSignal.timeout(20000)
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(
      'Supabase admin request error:',
      response.status,
      data
    );

    const error = new Error(
      data?.message || data?.hint || 'SUPABASE_REQUEST_FAILED'
    );

    error.status = response.status;
    error.details = data;

    throw error;
  }

  return data;
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
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) return null;

  return verifySupabaseUser(match[1]);
}

async function requireAuthenticatedUser(req, res) {
  const authorization = req.headers.authorization || '';

  if (!authorization) {
    res.status(401).json({
      error: 'Silakan login terlebih dahulu.'
    });

    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    res.status(401).json({
      error: 'Format autentikasi tidak valid.'
    });

    return null;
  }

  try {
    const user = await verifySupabaseUser(match[1]);

    if (!user) {
      res.status(401).json({
        error: 'Sesi login tidak valid atau sudah kedaluwarsa.'
      });

      return null;
    }

    return user;
  } catch (error) {
    console.error('Authentication error:', error.message);

    res.status(503).json({
      error: 'Gagal memverifikasi login. Coba lagi.'
    });

    return null;
  }
}

// ==========================================
// QUOTA SYSTEM
// ==========================================

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
    const message =
      result?.message ||
      result?.details ||
      '';

    if (message.includes('MODE_NOT_ENTITLED')) {
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

// ==========================================
// ACCOUNT ACCESS API
// ==========================================

app.get('/api/account/access', async (req, res) => {
  try {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;

    const params = new URLSearchParams({
      select: 'tier,status,starts_at,expires_at',
      user_id: `eq.${user.id}`,
      status: 'eq.active',
      starts_at: `lte.${new Date().toISOString()}`,
      expires_at: `gt.${new Date().toISOString()}`
    });

    const entitlements = await adminRequest(
      `ea_user_entitlements?${params.toString()}`
    );

    const activeTiers = new Set(
      (entitlements || []).map((item) => item.tier)
    );

    const hasPlus = activeTiers.has('plus');
    const hasProMax = activeTiers.has('pro_max');

    return res.json({
      authenticated: true,
      modes: {
        free: true,
        plus: hasPlus || hasProMax,
        pro_max: hasProMax
      },
      entitlements: entitlements || []
    });

  } catch (error) {
    console.error('Account access error:', error.message);

    return res.status(500).json({
      error: 'Gagal memeriksa paket akun.'
    });
  }
});

// ==========================================
// PAYMENT HELPERS
// ==========================================

function createOrderCode() {
  return (
    'EA-' +
    Date.now().toString(36).toUpperCase() +
    '-' +
    crypto.randomBytes(4).toString('hex').toUpperCase()
  );
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

async function createSignedProofUrl(proofPath) {
  const encodedPath = proofPath
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${PAYMENT_BUCKET}/${encodedPath}`,
    {
      method: 'POST',
      headers: getSupabaseHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        expiresIn: 86400
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.signedURL) {
    console.error('Signed proof URL error:', data);
    throw new Error('Gagal membuat link bukti pembayaran.');
  }

  return data.signedURL.startsWith('http')
    ? data.signedURL
    : `${SUPABASE_URL}${data.signedURL}`;
}

async function sendPaymentNotification({
  order,
  user,
  proofUrl,
  token
}) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY belum dikonfigurasi.');
  }

  const plan = PLANS[order.tier];

  const approveUrl =
    `${APP_URL}/api/payments/admin/decision` +
    `?token=${encodeURIComponent(token)}&decision=approve`;

  const rejectUrl =
    `${APP_URL}/api/payments/admin/decision` +
    `?token=${encodeURIComponent(token)}&decision=reject`;

  const buyerEmail = escapeHtml(user.email || 'Tidak tersedia');
  const orderCode = escapeHtml(order.order_code);
  const planName = escapeHtml(plan.name);
  const amount = `Rp${plan.amount.toLocaleString('id-ID')}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#20202a">
      <div style="padding:24px;background:#111827;color:white;border-radius:14px 14px 0 0">
        <h1 style="margin:0">ExcitementAI</h1>
        <p style="margin:8px 0 0;color:#cbd5e1">Permintaan verifikasi pembayaran</p>
      </div>

      <div style="padding:24px;border:1px solid #e5e7eb;border-radius:0 0 14px 14px">
        <h2>Pesanan baru</h2>

        <p><b>Kode pesanan:</b> ${orderCode}</p>
        <p><b>Email pembeli:</b> ${buyerEmail}</p>
        <p><b>Paket:</b> ${planName}</p>
        <p><b>Nominal:</b> ${amount}</p>

        <p>
          <a href="${escapeHtml(proofUrl)}"
             style="display:inline-block;padding:12px 18px;background:#2563eb;color:white;text-decoration:none;border-radius:8px">
            Lihat bukti pembayaran
          </a>
        </p>

        <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">

        <p>Pastikan uang benar-benar masuk ke DANA Bisnis sebelum menyetujui.</p>

        <p style="margin-top:24px">
          <a href="${escapeHtml(approveUrl)}"
             style="display:inline-block;padding:12px 18px;background:#16a34a;color:white;text-decoration:none;border-radius:8px;margin-right:8px">
            Approve
          </a>

          <a href="${escapeHtml(rejectUrl)}"
             style="display:inline-block;padding:12px 18px;background:#dc2626;color:white;text-decoration:none;border-radius:8px">
            Reject
          </a>
        </p>

        <p style="font-size:12px;color:#6b7280">
          Tautan berlaku selama 72 jam. Membuka tautan saja tidak akan mengubah status pesanan.
          Keputusan hanya diproses setelah tombol konfirmasi ditekan.
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
      from: RESEND_FROM,
      to: [ADMIN_EMAIL],
      subject: `Pembayaran ${plan.name} — ${order.order_code}`,
      html
    }),
    signal: AbortSignal.timeout(20000)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('Resend error:', response.status, data);
    throw new Error(
      data?.message || 'Gagal mengirim email verifikasi.'
    );
  }

  return data;
}

// ==========================================
// CREATE PAYMENT ORDER
// ==========================================

app.post('/api/payments/orders', async (req, res) => {
  try {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;

    const tier = req.body?.tier;

    if (!Object.prototype.hasOwnProperty.call(PLANS, tier)) {
      return res.status(400).json({
        error: 'Paket pembayaran tidak valid.'
      });
    }

    const orderCode = createOrderCode();
    const plan = PLANS[tier];

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + 24 * 60 * 60 * 1000
    );

    const inserted = await adminRequest('ea_payment_orders', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        order_code: orderCode,
        user_id: user.id,
        tier,
        amount: plan.amount,
        currency: 'IDR',
        status: 'pending',
        expires_at: expiresAt.toISOString()
      }
    });

    const order = Array.isArray(inserted)
      ? inserted[0]
      : inserted;

    if (!order) {
      throw new Error('Gagal membuat pesanan.');
    }

    return res.status(201).json({
      success: true,
      order: {
        order_code: order.order_code,
        tier: order.tier,
        amount: order.amount,
        expires_at: order.expires_at
      },
      qrisImage: QRIS_IMAGE
    });

  } catch (error) {
    console.error('Create payment order error:', error.message);

    return res.status(500).json({
      error: 'Pesanan gagal dibuat. Coba lagi.'
    });
  }
});

// ==========================================
// SUBMIT PAYMENT PROOF
// ==========================================

app.post('/api/payments/submit-proof', async (req, res) => {
  try {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;

    const orderCode = String(req.body?.order_code || '').trim();
    const proofPath = String(req.body?.proof_path || '').trim();

    if (!orderCode || !proofPath) {
      return res.status(400).json({
        error: 'Kode pesanan dan bukti pembayaran wajib diisi.'
      });
    }

    if (
      !proofPath.startsWith(`${user.id}/`) ||
      proofPath.includes('..') ||
      proofPath.length > 500
    ) {
      return res.status(403).json({
        error: 'Lokasi bukti pembayaran tidak valid.'
      });
    }

    const params = new URLSearchParams({
      select: '*',
      order_code: `eq.${orderCode}`,
      user_id: `eq.${user.id}`,
      limit: '1'
    });

    const found = await adminRequest(
      `ea_payment_orders?${params.toString()}`
    );

    const order = found?.[0];

    if (!order) {
      return res.status(404).json({
        error: 'Pesanan tidak ditemukan.'
      });
    }

    if (order.status !== 'pending') {
      return res.status(409).json({
        error: 'Pesanan ini sudah diproses atau tidak bisa digunakan.'
      });
    }

    if (new Date(order.expires_at).getTime() <= Date.now()) {
      await adminRequest(
        `ea_payment_orders?id=eq.${encodeURIComponent(order.id)}`,
        {
          method: 'PATCH',
          body: {
            status: 'expired'
          }
        }
      );

      return res.status(410).json({
        error: 'Pesanan sudah kedaluwarsa. Buat pesanan baru.'
      });
    }

    const proofUrl = await createSignedProofUrl(proofPath);

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(token);
    const tokenExpiresAt = new Date(
      Date.now() + 72 * 60 * 60 * 1000
    ).toISOString();

    const updated = await adminRequest(
      `ea_payment_orders?id=eq.${encodeURIComponent(order.id)}&status=eq.pending`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          status: 'review',
          proof_path: proofPath,
          approval_token_hash: tokenHash,
          approval_token_expires_at: tokenExpiresAt
        }
      }
    );

    if (!updated || updated.length === 0) {
      return res.status(409).json({
        error: 'Pesanan sudah berubah. Muat ulang dan coba lagi.'
      });
    }

    try {
      await sendPaymentNotification({
        order,
        user,
        proofUrl,
        token
      });
    } catch (emailError) {
      console.error('Payment email error:', emailError.message);

      // Kembalikan pesanan ke pending agar bukti dapat dikirim ulang.
      await adminRequest(
        `ea_payment_orders?id=eq.${encodeURIComponent(order.id)}&status=eq.review`,
        {
          method: 'PATCH',
          body: {
            status: 'pending',
            proof_path: null,
            approval_token_hash: null,
            approval_token_expires_at: null
          }
        }
      );

      return res.status(502).json({
        error:
          'Bukti tersimpan, tetapi email admin gagal dikirim. Coba kirim ulang beberapa saat lagi.'
      });
    }

    return res.json({
      success: true,
      message: 'Bukti pembayaran berhasil dikirim untuk diperiksa.'
    });

  } catch (error) {
    console.error('Submit proof error:', error.message);

    return res.status(500).json({
      error: 'Gagal mengirim bukti pembayaran.'
    });
  }
});

// ==========================================
// ADMIN APPROVAL HELPERS
// ==========================================

async function findReviewOrderByToken(token) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;

  const params = new URLSearchParams({
    select: '*',
    approval_token_hash: `eq.${sha256(token)}`,
    status: 'eq.review',
    approval_token_expires_at: `gt.${new Date().toISOString()}`,
    limit: '1'
  });

  const rows = await adminRequest(
    `ea_payment_orders?${params.toString()}`
  );

  return rows?.[0] || null;
}

function approvalPage(token, decision) {
  const safeToken = escapeHtml(token);
  const safeDecision = escapeHtml(decision);

  const actionLabel =
    decision === 'approve' ? 'Setujui pembayaran' : 'Tolak pembayaran';

  const color =
    decision === 'approve' ? '#16a34a' : '#dc2626';

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verifikasi Pembayaran — ExcitementAI</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#f8fafc;font-family:Arial,sans-serif;padding:20px}
.card{width:100%;max-width:440px;padding:28px;border:1px solid #26334d;background:#121b2e;border-radius:18px}
h1{font-size:24px;margin-top:0}
p{color:#b8c5d9;line-height:1.6}
button{width:100%;border:0;border-radius:10px;padding:14px;color:white;font-weight:bold;font-size:15px;background:${color};cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
#result{margin-top:16px;white-space:pre-wrap}
</style>
</head>
<body>
<div class="card">
  <h1>ExcitementAI</h1>
  <p>Lu akan ${decision === 'approve' ? 'menyetujui' : 'menolak'} satu permintaan pembayaran.</p>
  <p>Pastikan bukti dan transaksi DANA Bisnis sudah diperiksa.</p>
  <button id="confirm">${actionLabel}</button>
  <p id="result"></p>
</div>
<script>
const button=document.getElementById('confirm');
const result=document.getElementById('result');
button.addEventListener('click',async()=>{
  if(!confirm('Yakin ingin ${decision === 'approve' ? 'menyetujui' : 'menolak'} pembayaran ini?'))return;
  button.disabled=true;
  result.textContent='Memproses keputusan...';
  try{
    const response=await fetch('/api/payments/admin/decision',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        token:'${safeToken}',
        decision:'${safeDecision}'
      })
    });
    const data=await response.json().catch((
