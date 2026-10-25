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
    version: '2.0.0',
    provider: 'Gemini',
    providerConfigured: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: 'AI belum dikonfigurasi. Tambahkan GEMINI_API_KEY di Environment Variables Vercel.' });
    }

    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
    if (message.length > 12000) return res.status(413).json({ error: 'Pesan terlalu panjang. Coba ringkas pesanmu.' });

    const contents = [];
    for (const item of history.slice(-12)) {
      if (!item || !['user', 'model'].includes(item.role) || typeof item.text !== 'string') continue;
      const text = item.text.trim().slice(0, 12000);
      if (text) contents.push({ role: item.role, parts: [{ text }] });
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Kamu adalah ExcitementAI, asisten AI yang ramah, jujur, jelas, dan membantu. Jawab sesuai bahasa pengguna. Jika tidak tahu, katakan dengan jujur.' }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      }),
      signal: AbortSignal.timeout(45000)
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const upstreamMessage = data?.error?.message;
      const safeMessage = upstream.status === 400
        ? 'Permintaan ditolak oleh Gemini. Periksa model dan konfigurasi API key.'
        : upstream.status === 401 || upstream.status === 403
          ? 'Gemini menolak API key. Periksa API key dan aksesnya di Google AI Studio.'
          : upstream.status === 429
            ? 'Batas penggunaan Gemini sedang tercapai. Coba lagi sebentar.'
            : 'Layanan Gemini sedang bermasalah. Coba lagi nanti.';
      console.error('Gemini API error:', upstream.status, upstreamMessage || 'No upstream message');
      return res.status(upstream.status === 429 ? 429 : 502).json({ error: safeMessage });
    }

    const answer = (data?.candidates?.[0]?.content?.parts || [])
      .map(part => typeof part.text === 'string' ? part.text : '')
      .join('\n').trim();
    if (!answer) return res.status(502).json({ error: 'Gemini tidak mengirim jawaban. Coba kirim ulang pesanmu.' });
    return res.status(200).json({ answer, model });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return res.status(504).json({ error: 'Permintaan memerlukan waktu terlalu lama. Coba lagi.' });
    }
    console.error('Chat route error:', error?.message || error);
    return res.status(500).json({ error: 'Terjadi kesalahan di server. Coba lagi beberapa saat.' });
  }
});

// Keep unknown API paths as JSON errors instead of returning the website HTML.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint API tidak ditemukan.' }));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Format JSON tidak valid.' });
  }
  console.error('Unhandled server error:', err?.message || err);
  return res.status(500).json({ error: 'Terjadi kesalahan server.' });
});

// Vercel uses the exported app; local development uses the listener below.
if (require.main === module) {
  app.listen(PORT, () => console.log(`ExcitementAI ready at http://localhost:${PORT}`));
}
module.exports = app;
