# ExcitementAI

ExcitementAI is an AI chat application powered by Groq, with Supabase authentication, saved conversations, usage quotas, and Plus / Pro Max payment requests. The production backend entry point is `index.js`; `server/index.js` is a separate legacy prototype and is not used by the current `package.json` start script.

## Stack

- Node.js 20 or newer and Express 5
- Groq API for AI responses
- Supabase Auth, PostgREST, and Storage
- Resend for payment-review email notifications (optional until payment review is enabled)
- Static frontend in `public/`

## Required environment variables

Set these in Vercel → Project → Settings → Environment Variables. Never commit real values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | Private API key used by the server to call Groq. |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable key used for server-side user verification. |
| `SUPABASE_SECRET_KEY` | Yes | Supabase secret key used by trusted server routes. Keep private. |
| `GUEST_TOKEN_SECRET` | Yes | Long, random secret used to sign guest cookies. |
| `GROQ_MODEL` | No | Groq model override; defaults to `llama-3.3-70b-versatile`. |
| `RESEND_API_KEY` | Payment email | Sends payment-review notifications. |
| `APP_URL` | No | Canonical public app URL used in review links; otherwise Vercel URL / request host is used. |

`GUEST_TOKEN_SECRET` should be a randomly generated value with at least 32 bytes of entropy. Do not reuse a Supabase key or Groq key for it.

## Supabase setup

The browser Supabase project URL and publishable key are configured in `public/app.js`. A publishable key is intended for browser use; never put the Supabase secret key in frontend files.

The backend expects the following project resources to have already been created and configured:

- RPC function `ea_consume_daily_quota_for_mode`
- Tables used by chat history and payment orders, including `chat_conversations` and `ea_payment_orders`
- Storage bucket `ea-payment-proofs` with policies that allow authenticated users to upload their own proof files and trusted server access to review them
- Google OAuth enabled in Supabase Auth, with the deployed app URL added to the allowed redirect URLs

The exact SQL schema and Storage policies are project-specific; do not assume a fresh Supabase project is ready merely by adding environment variables.

## Deploy to Vercel

1. Push the repository to GitHub with `package.json` and `index.js` at the repository root.
2. In Vercel, import that repository as a project.
3. Use the Node.js runtime detected from `package.json`. Do not set `public/` as the Output Directory; Express serves it.
4. Add the required environment variables above.
5. Add the production URL to Supabase Auth → URL Configuration → Redirect URLs.
6. Deploy or redeploy after changing environment variables.
7. Open `/api/health`. Check that `providerConfigured` and `quotaConfigured` are `true`; `paymentConfigured` is only needed for payment-review email. The endpoint reports configuration presence, not whether credentials are valid.
8. Test Google login, send a chat message, open saved history, and (if payment features are configured) test the payment-order flow.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. Create a local `.env` file only on your own machine and never commit it.

## API endpoints

- `GET /api/health` — reports whether required environment variables are present.
- `POST /api/chat` — AI chat endpoint; accepts `{ "message": "...", "history": [], "mode": "free" }` and requires the server environment to be configured.
- `POST /api/payment/orders` — creates an authenticated payment order.
- `POST /api/payment/proof` — submits an uploaded payment proof for review.
- `GET /api/payment/review` and `POST /api/payment/review` — admin payment-review flow.

## Security checklist

- Never put `GROQ_API_KEY`, `SUPABASE_SECRET_KEY`, `GUEST_TOKEN_SECRET`, or `RESEND_API_KEY` in `public/`, browser JavaScript, HTML, or Git.
- Never share `.env` files or screenshots containing secret values.
- Keep Supabase Row Level Security and Storage policies enabled and restrictive.
- Payment status should only be changed through the trusted review flow; a client-side success screen is not proof of payment approval.

## Validation

Run `npm run check` to syntax-check the active backend and browser JavaScript. A syntax check does not verify live credentials, Supabase RPC/table policies, OAuth redirect configuration, Groq access, Resend delivery, or a production deployment. Those require live integration tests.
