#!/usr/bin/env node

/**
 * Publish the Chrome extension ZIP to the Chrome Web Store.
 *
 * Usage:
 *   node scripts/publish-extension.mjs <path-to-zip>
 *   node scripts/publish-extension.mjs --help
 *
 * Required env vars:
 *   CWS_CLIENT_ID       — Google OAuth2 client ID
 *   CWS_CLIENT_SECRET   — Google OAuth2 client secret
 *   CWS_REFRESH_TOKEN   — Google OAuth2 refresh token
 *   CWS_EXTENSION_ID    — Chrome Web Store extension ID
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// --- Help ---

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
  Usage: node scripts/publish-extension.mjs <path-to-zip>

  Uploads and publishes a Chrome extension ZIP to the Chrome Web Store.

  Required environment variables:
    CWS_CLIENT_ID       Google OAuth2 client ID
    CWS_CLIENT_SECRET   Google OAuth2 client secret
    CWS_REFRESH_TOKEN   Google OAuth2 refresh token
    CWS_EXTENSION_ID    Chrome Web Store extension ID
  `);
  process.exit(0);
}

// --- Validate ---

const REQUIRED_VARS = [
  "CWS_CLIENT_ID",
  "CWS_CLIENT_SECRET",
  "CWS_REFRESH_TOKEN",
  "CWS_EXTENSION_ID",
];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length) {
  console.error(
    `Missing required environment variables: ${missing.join(", ")}`,
  );
  process.exit(1);
}

const zipPath = process.argv[2];
if (!zipPath) {
  console.error("Usage: node scripts/publish-extension.mjs <path-to-zip>");
  process.exit(1);
}

const {
  CWS_CLIENT_ID,
  CWS_CLIENT_SECRET,
  CWS_REFRESH_TOKEN,
  CWS_EXTENSION_ID,
} = process.env;

// --- Step 1: Exchange refresh token for access token ---

console.log("  Exchanging refresh token for access token...");

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CWS_CLIENT_ID,
    client_secret: CWS_CLIENT_SECRET,
    refresh_token: CWS_REFRESH_TOKEN,
    grant_type: "refresh_token",
  }),
});

if (!tokenRes.ok) {
  const text = await tokenRes.text();
  console.error(`Token exchange failed (${tokenRes.status}): ${text}`);
  process.exit(1);
}

const { access_token } = await tokenRes.json();
console.log("  Access token obtained.");

// --- Step 2: Upload ZIP ---

console.log(`  Uploading ${zipPath}...`);

const zipBuffer = readFileSync(resolve(zipPath));

const uploadRes = await fetch(
  `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "x-goog-api-version": "2",
    },
    body: zipBuffer,
  },
);

const uploadData = await uploadRes.json();

if (uploadData.uploadState === "FAILURE") {
  console.error(
    "Upload failed:",
    JSON.stringify(uploadData.itemError, null, 2),
  );
  process.exit(1);
}

console.log(`  Upload complete (state: ${uploadData.uploadState}).`);

// --- Step 3: Publish ---

console.log("  Publishing...");

const publishRes = await fetch(
  `https://www.googleapis.com/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}/publish`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "x-goog-api-version": "2",
      "Content-Length": "0",
    },
  },
);

const publishData = await publishRes.json();

if (!publishData.status?.includes("OK")) {
  console.error("Publish response:", JSON.stringify(publishData, null, 2));
  // Don't exit 1 — "PENDING_REVIEW" is normal for first publishes
  if (publishData.status?.includes("ITEM_PENDING_REVIEW")) {
    console.log("  Extension is pending review (normal for new submissions).");
  } else {
    process.exit(1);
  }
} else {
  console.log("  Published successfully.");
}

console.log("\n  Done.\n");
