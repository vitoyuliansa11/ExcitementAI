import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.AI_API_KEY;
const BASE_URL = process.env.AI_BASE_URL || undefined;
const DEFAULT_MODEL = process.env.AI_MODEL || "gpt-4.1-mini";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "64kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Origin tidak diizinkan." });
  }
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const client = API_KEY ? new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL }) : null;

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", providerConfigured: Boolean(client), model: DEFAULT_MODEL });
});

app.post("/api/chat", async (req, res) => {
  if (!client) return res.status(503).json({ error: "Provider AI belum dikonfigurasi. Tambahkan AI_API_KEY di environment server." });
  const { messages, model, temperature = 0.7 } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 30) {
    return res.status(400).json({ error: "Format messages tidak valid." });
  }
  const safeMessages = [];
  for (const m of messages) {
    if (!m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string") {
      return res.status(400).json({ error: "Ada pesan dengan format tidak valid." });
    }
    if (m.content.length > 12000) return res.status(413).json({ error: "Pesan terlalu panjang (maksimum 12.000 karakter per pesan)." });
    safeMessages.push({ role: m.role, content: m.content });
  }
  const temp = Number(temperature);
  try {
    const completion = await client.chat.completions.create({
      model: typeof model === "string" && model.trim() ? model.trim().slice(0, 100) : DEFAULT_MODEL,
      messages: safeMessages,
      temperature: Number.isFinite(temp) ? Math.max(0, Math.min(1.5, temp)) : 0.7,
      max_tokens: 2500
    });
    const reply = completion.choices?.[0]?.message?.content;
    if (!reply || typeof reply !== "string") return res.status(502).json({ error: "Provider tidak mengembalikan teks jawaban." });
    res.json({ reply, model: completion.model || DEFAULT_MODEL });
  } catch (err) {
    console.error("AI provider request failed:", err?.status || "", err?.message || "unknown error");
    const status = err?.status === 401 ? 502 : (err?.status === 429 ? 429 : 502);
    res.status(status).json({ error: status === 429 ? "Batas permintaan provider tercapai. Coba lagi nanti." : "Provider AI gagal merespons. Periksa model, API key, saldo, atau konfigurasi provider." });
  }
});

app.use(express.static(path.join(__dirname, "../public")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));
app.listen(PORT, () => console.log(`ExcitementAi listening on port ${PORT}`));
