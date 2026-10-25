# ExcitementAI 2.0

ExcitementAI is a fresh, responsive AI chat interface powered by the Gemini API and designed for deployment on Vercel. Founder & Creator credit is included in the About page.

## Requirements
- GitHub account
- Vercel account
- Gemini API key from Google AI Studio

## Deploy from an Android phone
1. Download and extract this ZIP on your phone.
2. Upload the **contents** of the `ExcitementAI` folder to the root of your new, empty GitHub repository. `package.json` and `index.js` must be at the repository root, not inside an extra nested folder.
3. Open Vercel and import that GitHub repository as a new project.
4. Leave Framework Preset on the detected/default setting. Do not set `public` as the Output Directory; this is an Express app.
5. Before or after the first deployment, open **Project Settings → Environment Variables** and add:
   - `GEMINI_API_KEY` = your private Gemini API key
   - `GEMINI_MODEL` = `gemini-2.5-flash` (optional; this is already the default)
6. Redeploy after adding or changing environment variables.
7. Open `https://YOUR-PROJECT.vercel.app/api/health`. Expect JSON with `"status":"ok"`. `"providerConfigured":true` means the key variable exists; it does not guarantee that the key is valid.
8. Open the homepage and send a test message.

## Local run (optional)
```bash
npm install
npm start
```
Then open `http://localhost:3000`.

## API endpoints
- `GET /api/health` — app health and whether the Gemini key is configured.
- `POST /api/chat` — JSON body: `{ "message": "Hello", "history": [] }`.

## Security notes
- Never put the real Gemini API key in `public/`, browser JavaScript, HTML, or a committed `.env` file.
- Configure secrets in Vercel Environment Variables only.
- The browser calls this app's backend; the backend calls Gemini, so the key is not sent to the browser.
- Usage limits and charges, if any, depend on your Google AI Studio/Gemini account and current terms.

## Validation
Run `npm run check` to syntax-check the server and browser JavaScript. A syntax check cannot guarantee a successful live deployment; verify the health endpoint and a real chat response after setting up Vercel and Gemini.
