# Encryption Trade-offs

Context Vault encrypts entry data at rest in hosted mode using AES-256-GCM. This document explains what is and isn't encrypted, the split-authority key model, and the trade-offs involved.

## What is encrypted

In hosted mode, when `VAULT_MASTER_SECRET` is set, every entry's sensitive fields are encrypted before being written to the database:

| Field   | Encrypted        | Notes                                                                                          |
| ------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `body`  | Yes              | Primary content — always encrypted                                                             |
| `title` | Yes (copy)       | An encrypted copy is stored in `title_encrypted`. The plaintext title is also kept (see below) |
| `meta`  | Yes (if present) | Encrypted copy in `meta_encrypted`. Plaintext kept for structural queries                      |

Each entry gets a unique 12-byte IV (nonce). The auth tag is appended to the ciphertext, providing authenticated encryption — tampering is detected on decryption.

## What is NOT encrypted

These fields remain in plaintext in the SQLite database:

| Field                      | Why plaintext                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                    | Required by the FTS5 full-text search index. Without it, `get_context` queries can't match on titles                                                                                  |
| `body` (FTS preview)       | The FTS index tokenizes body text for search. FTS5 stores its own copy of indexed content                                                                                             |
| `kind`                     | Structural metadata used for filtering (`kind = 'insight'`)                                                                                                                           |
| `category`                 | Derived from kind (`knowledge`, `entity`, `event`) — used for filtering                                                                                                               |
| `tags`                     | Stored as JSON string — used for tag-based filtering                                                                                                                                  |
| `source`                   | Provenance tracking                                                                                                                                                                   |
| `identity_key`             | Entity deduplication key                                                                                                                                                              |
| `created_at`, `expires_at` | Temporal queries and TTL expiry                                                                                                                                                       |
| Embeddings                 | Vector embeddings are not reversible to plaintext, but they leak semantic similarity. An attacker with access to embeddings could determine that two entries are about similar topics |

## Split-authority encryption model

New users registered after the split-authority feature get a stronger key management model:

```
Registration:
  1. Server generates a random 32-byte DEK (Data Encryption Key)
  2. Server generates a client key share: cvs_<64 hex chars>
  3. KEK = scrypt(VAULT_MASTER_SECRET + clientKeyShare, salt)
  4. DEK is encrypted with KEK and stored in the meta database
  5. Client key share is returned once and must be saved by the user

Decryption (every request):
  1. Client sends API key in Authorization header
  2. Client sends vault secret in X-Vault-Secret header
  3. Server combines master secret + client share → derives KEK
  4. KEK decrypts the stored DEK
  5. DEK decrypts entry fields
```

Neither the server alone nor the client alone can decrypt entry bodies. Both halves are required.

### Legacy mode

Users registered before split-authority use server-only encryption:

```
KEK = scrypt(VAULT_MASTER_SECRET, salt)
```

The server can decrypt these entries without any client-side secret. This provides at-rest protection (the database file alone isn't readable) but not protection against a compromised server.

## The FTS trade-off

Full-text search (FTS5) requires plaintext tokens in the search index. This is a fundamental constraint of SQLite FTS — you can't search encrypted text without decrypting it first.

What this means in practice:

- **Titles** are stored in plaintext so search queries can match them
- **Body text** is tokenized by FTS5, which maintains its own internal data structures containing the indexed words
- An attacker with raw database access can read titles, see which words appear in entries (via the FTS index), and query the FTS index directly

This is an intentional trade-off: search functionality requires some plaintext exposure. Context Vault prioritizes being useful as a retrieval system over being a sealed vault.

## Threat model

| Threat                              | Protected? | Notes                                                           |
| ----------------------------------- | ---------- | --------------------------------------------------------------- |
| Database file stolen (disk/backup)  | Partial    | Bodies encrypted, but titles and FTS index readable             |
| Server compromise (split-authority) | Yes        | Attacker needs client key share from every user                 |
| Server compromise (legacy)          | No         | Server holds all keys needed to decrypt                         |
| Man-in-the-middle                   | Yes        | HTTPS required; API keys and vault secrets transmitted over TLS |
| Insider with DB access              | Partial    | Same as "database file stolen"                                  |

## Recommendations for sensitive data

1. **Use split-authority mode** — Register via Google OAuth or the latest API to get split-authority encryption automatically. Legacy email registrations also support it if `VAULT_MASTER_SECRET` is set.

2. **Keep sensitive details in the body** — Titles are always visible in the FTS index. Put sensitive content in the body, which is encrypted.

3. **Use generic titles** — Instead of "AWS credentials for prod-db", use "Cloud credentials reference". The body can contain the details.

4. **Avoid sensitive data in tags and meta** — These fields are not encrypted. Use them for structural categorization only.

5. **Save your vault secret** — The `cvs_...` secret shown at registration cannot be recovered. If lost, encrypted entries become permanently inaccessible.

## Implementation files

| File                                             | Role                                                      |
| ------------------------------------------------ | --------------------------------------------------------- |
| `packages/hosted/src/encryption/crypto.js`       | AES-256-GCM encrypt/decrypt primitives                    |
| `packages/hosted/src/encryption/keys.js`         | DEK generation, scrypt derivation, split-authority        |
| `packages/hosted/src/encryption/vault-crypto.js` | Bridge between vault entries and crypto layer             |
| `packages/hosted/src/server/user-ctx.js`         | Builds per-request decrypt function from user credentials |
