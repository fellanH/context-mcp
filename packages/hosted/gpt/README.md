# Setting Up Context Vault as a ChatGPT Custom GPT

## Prerequisites

1. A Context Vault account with an API key (`cv_...`)
2. Your Context Vault server URL (e.g., `https://vault.yourdomain.com`)

## Setup Steps

### 1. Create a New GPT

Go to [ChatGPT GPT Builder](https://chat.openai.com/gpts/editor) and click "Create a GPT".

### 2. Configure Instructions

Copy the contents of `system-prompt.md` into the **Instructions** field.

### 3. Add Actions

1. Click **"Create new action"**
2. Set **Authentication**:
   - Type: **API Key**
   - Auth Type: **Bearer**
   - Header: keep default (`Authorization`)
3. In the **Schema** section, click **"Import from URL"**
4. Enter: `https://YOUR_SERVER/api/vault/openapi.json`
5. Click **Import** — all 7 endpoints will be loaded automatically

### 4. Configure Settings

| Setting               | Value                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| Name                  | Context Vault                                                             |
| Description           | Your personal knowledge assistant with long-term memory                   |
| Conversation starters | "What do I know about...", "Save this insight:", "Search my vault for..." |

### 5. Privacy Policy

Set the privacy policy URL to: `https://YOUR_SERVER/privacy`

### 6. Test

Try these prompts:

- "Search my vault for recent decisions"
- "Save this as an insight: Hybrid search outperforms pure FTS for knowledge retrieval"
- "What projects am I working on?"

## Troubleshooting

- **401 errors**: Check that your API key is correctly set in the action authentication
- **Connection refused**: Verify your server URL is publicly accessible (not localhost)
- **No results**: Your vault may be empty — try saving a few entries first

## Using with Gemini

See `gemini-functions.json` for Google AI Studio function declarations that map to the same API.
