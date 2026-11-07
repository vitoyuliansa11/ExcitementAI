
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
  GUEST_TOKEN_SECRET
} = process.env;

const COOKIE_NAME = 'ea_guest';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const ALLOWED_MODES = new Set(['free', 'plus', 'pro_max']);

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
  const first = Buffer.from(a);
  const second = Buffer.from(b);

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
      result?.message || result?.details || result?.hint || ''
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

// HEALTH CHECK DAN DIAGNOSTIK
app.get('/api/health', (_req, res) => {
  const envCheck = {
    groq: Boolean(process.env.GROQ_API_KEY),
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
    supabasePublishableKey: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY),
    supabaseSecretKey: Boolean(process.env.SUPABASE_SECRET_KEY),
    guestTokenSecret: Boolean(process.env.GUEST_TOKEN_SECRET)
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
    version: '2.3.0',
    provider: 'Groq',
    providerConfigured,
    quotaConfigured,
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
    
