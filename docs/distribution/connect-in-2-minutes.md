# Connect in 2 Minutes (Hosted)

Use Context Vault in the cloud — no local install, no Node.js. Works across devices. Sign up at [context-vault.com](https://www.context-vault.com/), get an API key, then add the MCP endpoint to your AI tool.

**Endpoints:**

| Service   | URL                                                    |
| --------- | ------------------------------------------------------ |
| Dashboard | `https://app.context-vault.com/`                       |
| MCP       | `https://www.context-vault.com/mcp`                    |
| OpenAPI   | `https://www.context-vault.com/api/vault/openapi.json` |
| Privacy   | `https://www.context-vault.com/privacy`                |

---

## 1. Get an API key

1. Go to [context-vault.com](https://www.context-vault.com/)
2. Sign up (Google OAuth or email)
3. Copy your `cv_...` API key from the dashboard

**Or** use the CLI connect command — it auto-detects tools and configures MCP:

```bash
npx context-vault connect --key cv_YOUR_API_KEY
```

---

## 2. Claude Code

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "context-vault": {
      "url": "https://www.context-vault.com/mcp",
      "headers": {
        "Authorization": "Bearer cv_YOUR_API_KEY"
      }
    }
  }
}
```

---

## 3. Cursor

Add an MCP server in Cursor settings:

- **URL:** `https://www.context-vault.com/mcp`
- **Header:** `Authorization: Bearer cv_YOUR_API_KEY`

---

## 4. GPT Actions

1. Import OpenAPI from `https://www.context-vault.com/api/vault/openapi.json`
2. Configure Bearer auth with your `cv_...` key
3. Set privacy URL to `https://www.context-vault.com/privacy`

---

## 5. Validate

In your AI client, run:

1. `context_status` — should show vault info
2. `save_context` with a short insight
3. `get_context` with a matching query

All three succeed → you're ready.
