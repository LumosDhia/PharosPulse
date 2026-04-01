# uptime.lumosdhia.com

A real-time uptime monitoring dashboard powered by **Cloudflare Workers + KV**.

## Features
- 🔍 Checks multiple services every 5 minutes (Cron Trigger)
- 📊 Beautiful status dashboard at `uptime.lumosdhia.com`
- 🔔 Telegram alerts when a service goes DOWN
- 🌐 JSON API at `/api/status` for programmatic access

---

## Local Development

1.  **Add your secrets** to `.dev.vars`:
    ```
    TELEGRAM_BOT_TOKEN="your_token"
    TELEGRAM_CHAT_ID="your_chat_id"
    ```

2.  **Create a KV namespace** (needed once):
    ```bash
    npm run kv:create
    ```
    Copy the `id` from the output and paste it in `wrangler.toml`.

3.  **Run locally**:
    ```bash
    npm run dev
    ```
    - Visit `http://localhost:8787` → See the dashboard
    - Visit `http://localhost:8787/test` → Trigger a live check now
    - Visit `http://localhost:8787/api/status` → JSON output

---

## Deploy to Production

```bash
# Login to Cloudflare
npx wrangler login

# Add production secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID

# Deploy
npm run deploy
```

Then in Cloudflare Dashboard → Workers → your worker → Custom Domains, add `uptime.lumosdhia.com`.

---

## Add More Services
Edit `SERVICES` at the top of `src/index.js`:
```javascript
const SERVICES = [
  { name: "Main Portfolio",  url: "https://lumosdhia.com" },
  { name: "EcoSpot App",    url: "https://ecospot.lumosdhia.com" },
  // Add more here!
];
```
