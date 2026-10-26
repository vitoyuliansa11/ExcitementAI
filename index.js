
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'ExcitementAI',
    version: '2.1.0',
    provider: 'Groq',
    providerConfigured: Boolean(process.env.GROQ_API_KEY),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error: 'AI belum dikonfigurasi. Tambahkan GROQ_API_KEY di Environment Variables Vercel.'
      });
    }

    const body = req.body || {};
    const message =
      typeof body.message === 'string' ? body.message.trim() : '';
    const history = Array.isArray(body.history) ? body.history : [];

    if (!message) {
      return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
    }

    if (message.length > 12000) {
      return res.status(413).json({
        error: 'Pesan terlalu panjang. Coba ringkas pesanmu.'
      });
    }

    const messages = [{
      role: 'system',
      content:
        'Kamu adalah ExcitementAI, asisten AI yang ramah, jujur, jelas, dan membantu. Jawab sesuai bahasa pengguna. Jika tidak tahu, katakan dengan jujur.'
    }];

    for (const item of history.slice(-12)) {
      if (!item || typeof item.text !== 'string') continue;

      const role = item.role === 'model' ? 'assistant' : item.role;
      if (!['user', 'assistant'].includes(role)) continue;

      const text = item.text.trim().slice(0, 12000);
      if (text) messages.push({ role, content: text });
    }

    messages.push({ role: 'user', content: message });

    const model = (
      process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
    ).trim();

    const upstream = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
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
          error: 'Groq menolak API key atau akses akun. Periksa konfigurasi Groq.'
        });
      }

      if (status === 429) {
        return res.status(429).json({
          error: 'Batas penggunaan Groq tercapai. Coba lagi nanti.'
        });
      }

      if (status === 400 || status === 404) {
        return res.status(502).json({
          error: 'Model atau permintaan Groq tidak diterima. Periksa konfigurasi model.'
        });
      }

      return res.status(502).json({
        error: 'Layanan Groq sedang bermasalah. Coba lagi nanti.'
      });
    }

    const answer = data?.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return res.status(502).json({
        error: 'Groq tidak mengirim jawaban. Coba kirim ulang pesanmu.'
      });
    }

    return res.status(200).json({ answer, model });
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
      error: 'Terjadi kesalahan di server. Coba lagi beberapa saat.'
    });
  }
});

app.use('/api', (_req, res) =>
  res.status(404).json({ error: 'Endpoint API tidak ditemukan.' })
);

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Format JSON tidak valid.' });
  }

  console.error('Unhandled server error:', err?.message || err);

  return res.status(500).json({
    error: 'Terjadi kesalahan server.'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ExcitementAI ready at http://localhost:${PORT}`);
  });
}

module.exports = app;
        
