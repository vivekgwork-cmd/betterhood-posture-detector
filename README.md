# Slouch Catcher (prototype)

Upload a photo, and a vision AI decides whether the posture is **good** or **bad**. It explains why in 2–3 sentences and, for bad posture, recommends one betterhood product.

## Run it

```powershell
copy .env.example .env      # then paste your GEMINI_API_KEY into .env
npm start                   # http://localhost:3000
```

There are no dependencies to install; it needs Node 20.6 or newer. With no key in `.env`, it runs in **demo mode** and returns a sample result so you can click through the UI.

To test on your phone, run the server and open `http://<your-PC's-LAN-IP>:3000` on the same Wi-Fi. For the "Take a photo" camera button on a phone, deploy it over HTTPS (see below).

## How it works

```
Browser                                   server.js                     Vision AI
-------                                   ---------                     ---------
pick / snap / drop / paste photo
  -> resized to 1024px JPEG  ---POST /api/analyze--> rate-limit, validate
                                                     prompt + product list --> Gemini (JSON schema)
                                                     <-- {verdict, score, summary, issues, product_id}
  <-- verdict + product card ----------------------- map product_id -> products.js
```

- **The API key stays on the server.** The browser never sees it.
- **Photos are never stored.** They're held in memory for one request only.
- **The names and phone number are asked for last, when they tap "Roast on WhatsApp".** The form asks for the catcher's name, the caught person's name and the catcher's phone number. The names go on the Caught Card and in the WhatsApp text. The phone is never shown. Each form sent adds one line to `data/leads.jsonl` via `POST /api/lead`: names, phone, verdict and score, no photo. That file is gitignored, and `LEADS_FILE` moves it. If they close the form or tap "No thanks", they can still download the card, without names.
- **The Caught Card is a 1080×1350 JPEG drawn in the browser.** On phones, "Roast on WhatsApp" opens the share sheet with the image attached. On desktops, it saves the image and opens WhatsApp with the text.
- The AI is **forced to pick a product from `products.js`**, so it can't invent products or links.
- The verdict can be `good`, `bad` or `unclear`. `unclear` covers photos with no person, only a face, and similar cases.
- The server rate-limits each IP (default 6 per minute) to protect the free quota.

## Files

| File | What |
|---|---|
| `server.js` | Static server + `/api/analyze`, prompt, Gemini / OpenAI-compatible / demo providers |
| `products.js` | Curated posture-relevant products from shop.betterhood.in (price, image, link, "best for" hint for the AI) |
| `public/` | Front-end, themed after `figma-file-references/` (plum gradient, amber buttons, Montserrat + Gochi Hand) |

## Switching AI provider

Everything is set in `.env`:

- **Gemini (default):** `GEMINI_API_KEY`, and `GEMINI_MODEL=gemini-flash-latest` (or `gemini-flash-lite-latest` for a larger free quota).
- **OpenRouter, Groq or any other OpenAI-compatible API:** `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (the model must accept images).

## Editing products

Edit `products.js`. The `fits` text is what the AI reads to choose a product, so describe the posture or setting each product solves.

## Deploying

This is a plain Node server, so it runs as-is on Render, Railway, Fly.io or a small VPS. Set the same env vars there.

To embed it in the WordPress page, host this app and put it in the page with an `<iframe>`. Or host only `/api/analyze` and point the front-end's `fetch('/api/analyze')` at that URL, adding CORS headers.
