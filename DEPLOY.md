# Deploying the OAuth backend

There are two backends included:

- **`backend/`** — a plain Express server for App Service (simple, but the
  free tier sleeps and the always-on tier costs a flat ~$13/month).
- **`backend-functions/`** — the same one endpoint as an Azure Function on
  the **Consumption plan**. Recommended: effectively free (1M free
  executions/month), the URL is always live, and the ~1-2s cold start on an
  idle function is unnoticeable inside an OAuth popup flow. Use this one
  unless you have a reason not to.

Both expose the same route — `POST /api/github/token` — so the extension
doesn't care which one you point it at.

---

## Step 0 (do this first, either option): Register a GitHub OAuth App

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App
2. **Homepage URL**: anything, e.g. `https://example.com`
3. **Authorization callback URL**: this must exactly match what the
   extension sends. Chrome extensions get a redirect URL of the form:

   ```
   https://<your-extension-id>.chromiumapp.org/
   ```

   Load the unpacked extension first (`chrome://extensions` → Developer
   mode → Load unpacked) to see its ID, then come back and set this as the
   callback URL.
4. Save. You'll get a **Client ID** (public — goes in the extension) and
   you can generate a **Client Secret** (goes ONLY on your backend, never
   in the extension).

---

## Option A: Azure Functions (recommended, near-$0)

### 1. Create the Function App (Consumption plan)

Run in Azure Cloud Shell:

```bash
RESOURCE_GROUP="leetsync-rg"
STORAGE_ACCOUNT="leetsyncstorage$RANDOM"   # must be globally unique, lowercase
FUNCTION_APP="leetsync-oauth-func-yourname"  # must be globally unique
LOCATION="eastus"

az group create --name $RESOURCE_GROUP --location $LOCATION

# Functions requires a storage account (used for internal bookkeeping,
# not for your data) — costs pennies at this scale
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS

az functionapp create \
  --resource-group $RESOURCE_GROUP \
  --consumption-plan-location $LOCATION \
  --runtime node \
  --runtime-version 20 \
  --functions-version 4 \
  --name $FUNCTION_APP \
  --storage-account $STORAGE_ACCOUNT \
  --os-type Linux

echo "Backend URL: https://$FUNCTION_APP.azurewebsites.net"
```

### 2. Deploy the code

Upload `backend-functions/` into Cloud Shell (upload button in the
toolbar), then from inside that folder:

```bash
npm install
func azure functionapp publish $FUNCTION_APP
```

(Cloud Shell has Azure Functions Core Tools — `func` — preinstalled.)

### 3. Set the secrets

```bash
az functionapp config appsettings set \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --settings \
    GITHUB_CLIENT_ID="paste_client_id_here" \
    GITHUB_CLIENT_SECRET="paste_client_secret_here" \
    ALLOWED_EXTENSION_ORIGIN="chrome-extension://paste_your_extension_id_here"
```

### 4. Verify

```bash
curl https://$FUNCTION_APP.azurewebsites.net/api/health
# -> ok
```

### 5. Point the extension at it

In the popup's OAuth section, set **Backend URL** to
`https://<your-function-app>.azurewebsites.net` and **Client ID** to the
value from step 1. Click Connect.

### Cost reality check
At personal-use volumes (a handful of OAuth connects, ever) this stays
inside the free monthly grant indefinitely — realistically $0.00-$0.05/month,
dwarfed by your $300 credit. The storage account is the only thing that
bills even slightly, and it's fractions of a cent at this scale.

---

## Option B: App Service (Express server)

Use this instead if you'd rather have a persistent server you can extend
later (e.g. add more endpoints, a dashboard, etc). Costs the flat B1 rate
(~$13/month) if you want zero cold starts, or use the F1 free tier and
accept cold starts after ~20 min idle.

## 1. Deploy the backend to Azure App Service

From `backend/`:

```bash
npm install
```

**Option A — Azure CLI**
```bash
az webapp up \
  --name your-leetsync-oauth \
  --runtime "NODE:20-lts" \
  --resource-group your-resource-group
```

**Option B — your existing Azure VM**
Just run it behind whatever reverse proxy (nginx/Caddy) you already use for
HTTPS termination — `npm start`, proxy port 8080, done.

## 2. Set environment variables

In Azure App Service: **Configuration → Application settings**, add:

| Name | Value |
|---|---|
| `GITHUB_CLIENT_ID` | from step 1 |
| `GITHUB_CLIENT_SECRET` | from step 1 |
| `ALLOWED_EXTENSION_ORIGIN` | `chrome-extension://<your-extension-id>` |

Restart the app after saving.

## 3. Point the extension at it

In `manifest.json`, `host_permissions` already includes
`https://*.azurewebsites.net/*`. If you're using a custom domain instead,
add it there too.

In the extension popup, expand **"Connect via GitHub OAuth"**, enter:
- **Client ID** — from step 1
- **Backend URL** — e.g. `https://your-leetsync-oauth.azurewebsites.net`

Click **Connect with GitHub**. A GitHub authorization popup opens, you
approve, and the extension stores the resulting access token automatically
— same as if you'd pasted a PAT, just without the manual copy/paste.

## Security notes

- The client secret only ever lives in Azure App Service's environment
  variables — never in the extension bundle, which is publicly readable by
  anyone who installs it.
- Lock `ALLOWED_EXTENSION_ORIGIN` down to your specific extension ID once
  you know it, rather than leaving it as `*`.
- The backend doesn't log or store the code or token — it's a pure
  pass-through exchange.
