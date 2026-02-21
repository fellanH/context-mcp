# Chrome Web Store — Setup Guide

One-time setup for publishing the Context Vault extension to the Chrome Web Store.

## 1. Register a CWS Developer Account

1. Go to https://chrome.google.com/webstore/devconsole
2. Pay the one-time $5 registration fee
3. Complete identity verification (may take a few days)

## 2. Create a Google Cloud Project

1. Go to https://console.cloud.google.com
2. Create a new project (e.g. "Context Vault CWS")
3. Enable the **Chrome Web Store API**:
   - Navigate to APIs & Services → Library
   - Search for "Chrome Web Store API"
   - Click **Enable**

## 3. Create OAuth2 Credentials

1. In the Google Cloud project, go to APIs & Services → Credentials
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Desktop app**
4. Name: "Context Vault CWS Publisher"
5. Save the **Client ID** and **Client Secret**

## 4. Get a Refresh Token

Run the OAuth2 consent flow to obtain a refresh token. You only need to do this once.

### Option A: Using curl

```bash
# 1. Open this URL in your browser (replace CLIENT_ID):
echo "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob"

# 2. Authorize and copy the code

# 3. Exchange code for tokens:
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=CLIENT_ID" \
  -d "client_secret=CLIENT_SECRET" \
  -d "code=AUTH_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"

# 4. Save the refresh_token from the response
```

### Option B: Using the OAuth Playground

1. Go to https://developers.google.com/oauthplayground
2. Click the gear icon → check "Use your own OAuth credentials"
3. Enter your Client ID and Client Secret
4. In the left panel, find "Chrome Web Store API v1.1" and select the `https://www.googleapis.com/auth/chromewebstore` scope
5. Click "Authorize APIs" and grant access
6. Click "Exchange authorization code for tokens"
7. Copy the **refresh token**

## 5. First Manual Upload

The CWS API can only update an existing item — you must do the first upload manually.

1. Build the extension: `npm run extension:build`
2. Package it: `cd packages/extension/dist && zip -r ../../../extension.zip .`
3. Go to the [CWS Developer Dashboard](https://chrome.google.com/webstore/devconsole)
4. Click **New Item** and upload `extension.zip`
5. Fill in the listing details:
   - Description: use `packages/extension/store/description.txt`
   - Screenshots: upload from `packages/extension/store/screenshots/`
   - Privacy policy URL: `https://www.context-vault.com/privacy`
   - Category: Productivity
   - Language: English
6. Submit for review
7. Copy the **Extension ID** from the dashboard URL (32-character string)

## 6. Add GitHub Secrets

In the GitHub repository settings (Settings → Secrets → Actions), add:

| Secret              | Value                       |
| ------------------- | --------------------------- |
| `CWS_CLIENT_ID`     | Google OAuth2 Client ID     |
| `CWS_CLIENT_SECRET` | Google OAuth2 Client Secret |
| `CWS_REFRESH_TOKEN` | Refresh token from step 4   |
| `CWS_EXTENSION_ID`  | Extension ID from step 5    |

## 7. Verify Automated Publishing

After adding the secrets, the next `v*` tag push will trigger `.github/workflows/publish-extension.yml`, which builds the extension and publishes it to the Chrome Web Store automatically.

You can also trigger it manually from the Actions tab using the "Run workflow" button.
