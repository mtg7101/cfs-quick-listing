# CFS Quick Listing

Minimal, single-page payload-giver UI for the Centerfire BigCommerce
listing agent. The browser submits a small product form (title, SKU,
UPC, price, AI context) to a Node/Express backend; the backend forwards
the payload to the Google Agent Platform `cfs-product-listing-agent`
which owns optimization and the BigCommerce write end-to-end.

> POPS is unaffected. This tool is a separate, standalone interface.

## What's here

- `server.js` — Express server with three endpoints:
  - `POST /api/listing` — create + (optionally) publish.
  - `GET /api/product/:sku` — look up a product by SKU.
  - `POST /api/product/:sku/update` — update + (optionally) publish.
- `lib/agent.js` — thin Google-Auth client that posts to the agent's
  `:query` endpoint with `classMethod=publish_product_listing` /
  `search_products`.
- `public/` — single-page HTML/CSS/JS UI with two sections:
  1. **Create a product** — Title, SKU, UPC, Price, Context for AI →
     `Generate Preview` (dry run) or `Generate + Publish` (live).
  2. **Update an existing product** — type a SKU, query, edit fields, push.
- `ecosystem.config.cjs` — PM2 process definition (port `4100` by default).
- `.github/workflows/deploy.yml` — CI/CD pipeline that SSH-deploys to
  the production host on every push to `main`.
- `scripts/server-bootstrap.sh` — one-time setup script for the host.

## Local run

```bash
cp .env.example .env
# Fill in GOOGLE_AGENT_CREDENTIALS_JSON (service account JSON or base64).
npm install
npm start
# → http://localhost:4100
```

The agent operations being called are exposed by the deployed
reasoning engine `projects/461200744927/locations/us-east1/reasoningEngines/6189142156658081792`.
The agent enforces inventory-stripping, parent-category resolution,
custom_url generation, and BigCommerce type coercion server-side.

## Deploy (production)

The host (`10.0.0.179`) runs the app under PM2.

### One-time bootstrap on the host

```bash
ssh cfserver@10.0.0.179
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/mtg7101/cfs-quick-listing
cd cfs-quick-listing
bash scripts/server-bootstrap.sh
# Edit .env with the agent credentials, then:
pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 startup
```

### CI/CD

Add three repository secrets in GitHub → Settings → Secrets and variables
→ Actions:

| Secret             | Value                |
|--------------------|----------------------|
| `DEPLOY_HOST`      | `10.0.0.179`         |
| `DEPLOY_USER`      | `cfserver`           |
| `DEPLOY_PASSWORD`  | the host's password  |

Pushing to `main` triggers `.github/workflows/deploy.yml`, which SSHs
into the host, pulls the latest commit, runs `npm ci`, and reloads the
PM2 service.

## Configuration (`.env`)

```env
PORT=4100
AGENT_ENDPOINT_URL=https://us-east1-aiplatform.googleapis.com/v1/projects/cfsagents/locations/us-east1/reasoningEngines/6189142156658081792:query
AGENT_PROJECT=cfsagents
GOOGLE_AGENT_CREDENTIALS_JSON='{"type":"service_account",...}'
```

Either inline the service-account JSON in `GOOGLE_AGENT_CREDENTIALS_JSON`
(single line, single-quoted) or set `GOOGLE_APPLICATION_CREDENTIALS` to
a key file path.

## Health check

`GET /api/health` returns `{ ok, service, port }` so PM2 / monitoring can
verify the process.
