# PharosPulse 🏮

**PharosPulse** is a professional, high-performance serverless uptime monitoring dashboard built to run at the edge using Cloudflare Workers. It provides real-time health tracking, historical availability data (365-day view), and instant Telegram alerting with a sleek, modern UI based on the Catppuccin Mocha color palette.

## 🚀 Features

- **Serverless Execution**: Powered by Cloudflare Workers for near-zero cost and global distribution.
- **Persistent Storage**: Uses Cloudflare KV to store historical uptime data and stats.
- **Historic Charts**: Visualizes availability over the last 7 days, 30 days, and 365 days.
- **Localized Time**: Displays "Last Checked" times in the visitor's local timezone automatically.
- **Smart Refresh**: High-precision auto-refreshing UI that bypasses browser background throttling.
- **Enterprise UI**: Elegant "Catppuccin Mocha" dark mode design with glassmorphism and smooth animations.
- **Instant Alerts**: Integrated Telegram bot notifications when a service goes down.

## 🛠️ Getting Started

### 1. Prerequisites
- A [Cloudflare Account](https://dash.cloudflare.com/)
- [Node.js](https://nodejs.org/) and `npm` installed.
- Cloudflare Wrangler CLI (`npm install -g wrangler`)

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/LumosDhia/uptime-monitor.git
cd uptime-monitor

# Install dependencies
npm install
```

### 3. Setup Cloudflare KV
Create a KV namespace in your Cloudflare dashboard (under Workers & Pages > KV) or via CLI:
```bash
npx wrangler kv:namespace create UPTIME_KV
```
Copy the generated ID and paste it into your `wrangler.toml` file under `[[kv_namespaces]]`.

### 4. Configuration
Modify `src/index.js` to add your specific services:
```javascript
const SERVICES = [
  { name: "My Website", url: "https://example.com", group: "Core" },
  { name: "Public API", url: "https://api.example.com", group: "Apps" },
];
```

### 5. Deployment
Login to Cloudflare and deploy the worker:
```bash
npx wrangler login
npx wrangler deploy
```

### 6. Adding Your Domain (Custom URL)
To use your own domain (e.g., `status.yourdomain.com`):
1. Go to your **Worker Dashboard** in Cloudflare.
2. Select **Settings** > **Triggers**.
3. Under **Custom Domains**, click **Add Custom Domain**.
4. Enter the subdomain you want to use and follow the DNS verification steps.

## ⏰ Monitoring Intervals
By default, PharosPulse is configured with a **30-minute cron interval** (`*/30 * * * *` in `wrangler.toml`). 

- **Free Tier Optimized**: This setting is designed to stay well within the Cloudflare Workers KV free tier (1,000 daily writes).
- **Critical Infrastructure**: For mission-critical endpoints, it is highly recommended to change the interval to **5 minutes** (`*/5 * * * *`), which is the industry standard for high-precision monitoring. This will ensure faster incident detection but may exceed the 1,000 daily write limit if monitoring many services.

PharosPulse uses a robust client-side precision timer to ensure the dashboard remains accurate even if the browser background tab is throttled.

## 📝 License
This project is open-source and available under the [MIT License](LICENSE).

---
*Developed by [LumosDhia](https://github.com/LumosDhia)*
