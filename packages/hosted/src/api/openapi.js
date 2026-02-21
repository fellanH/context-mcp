/**
 * openapi.js — OpenAPI 3.1 spec generation for vault REST API.
 *
 * Serves the spec at GET /api/vault/openapi.json (unauthenticated).
 * Descriptions are optimized for LLM consumption (ChatGPT GPTs, Gemini, etc.).
 */

/**
 * Generate the OpenAPI 3.1.0 spec document.
 * @param {{ version?: string, serverUrl?: string }} opts
 */
export function generateOpenApiSpec({ version = "1.0.0", serverUrl } = {}) {
  const servers = [];
  if (serverUrl) servers.push({ url: serverUrl, description: "Production" });
  servers.push({
    url: "http://localhost:3000",
    description: "Local development",
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "Context Vault API",
      version,
      description:
        "REST API for Context Vault — a personal knowledge base with hybrid semantic search. Store insights, decisions, patterns, entities, and events, then retrieve them with natural language queries combining full-text and vector similarity search.",
      contact: {
        name: "Context Vault",
        url: "https://github.com/fellanH/context-vault",
      },
    },
    servers,
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API Key",
          description:
            "API key starting with cv_. Get one via POST /api/register.",
        },
      },
      schemas: {
        Entry: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "ULID identifier",
              example: "01JKLMNPQR5678ABCDEF",
            },
            kind: {
              type: "string",
              description:
                "Entry kind (insight, decision, pattern, contact, etc.)",
              example: "insight",
            },
            category: {
              type: "string",
              enum: ["knowledge", "entity", "event"],
              description: "Auto-assigned category based on kind",
            },
            title: {
              type: ["string", "null"],
              example: "Hybrid search outperforms FTS alone",
            },
            body: { type: ["string", "null"], description: "Main content" },
            tags: {
              type: "array",
              items: { type: "string" },
              example: ["search", "architecture"],
            },
            meta: {
              type: "object",
              additionalProperties: true,
              description: "Structured metadata",
            },
            source: { type: ["string", "null"], example: "claude-code" },
            identity_key: {
              type: ["string", "null"],
              description: "Unique key for entity upsert",
            },
            expires_at: {
              type: ["string", "null"],
              description: "ISO date TTL",
            },
            created_at: { type: "string", format: "date-time" },
          },
        },
        SearchResult: {
          allOf: [
            { $ref: "#/components/schemas/Entry" },
            {
              type: "object",
              properties: {
                score: {
                  type: "number",
                  description: "Relevance score (0-1)",
                  example: 0.847,
                },
              },
            },
          ],
        },
        Error: {
          type: "object",
          properties: {
            error: {
              type: "string",
              description: "Human-readable error message",
            },
            code: {
              type: "string",
              description: "Machine-readable error code",
            },
          },
        },
      },
    },
    paths: {
      "/api/vault/entries": {
        get: {
          operationId: "listEntries",
          summary: "List vault entries",
          description:
            "Browse vault entries with optional filters and pagination. Returns entries sorted by creation date (newest first). Use POST /api/vault/search instead when you have a specific topic to find — it uses semantic understanding.",
          tags: ["Entries"],
          parameters: [
            {
              name: "kind",
              in: "query",
              schema: { type: "string" },
              description:
                "Filter by kind (e.g. insight, decision, pattern, contact)",
            },
            {
              name: "category",
              in: "query",
              schema: {
                type: "string",
                enum: ["knowledge", "entity", "event"],
              },
              description: "Filter by category",
            },
            {
              name: "since",
              in: "query",
              schema: { type: "string", format: "date-time" },
              description: "Only entries created after this ISO date",
            },
            {
              name: "until",
              in: "query",
              schema: { type: "string", format: "date-time" },
              description: "Only entries created before this ISO date",
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 20,
              },
              description: "Max entries to return",
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0, default: 0 },
              description: "Skip first N entries for pagination",
            },
          ],
          responses: {
            200: {
              description: "List of entries with pagination metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      entries: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Entry" },
                      },
                      total: { type: "integer" },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                    },
                  },
                },
              },
            },
            401: {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
        post: {
          operationId: "createEntry",
          summary: "Create a new vault entry",
          description:
            "Save new knowledge to the vault. The entry is written to disk as a markdown file and indexed for search. KNOWLEDGE kinds (insight, decision, pattern, reference) are enduring. ENTITY kinds (contact, project, tool, source) require identity_key for upsert. EVENT kinds (session, log, feedback) decay over time in search relevance.",
          tags: ["Entries"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["kind", "body"],
                  properties: {
                    kind: {
                      type: "string",
                      pattern: "^[a-z0-9-]+$",
                      maxLength: 64,
                      description:
                        "Entry kind — determines category and folder",
                      example: "insight",
                    },
                    body: {
                      type: "string",
                      maxLength: 102400,
                      description: "Main content (max 100KB)",
                      example:
                        "Hybrid search combining FTS5 with vector similarity outperforms either alone.",
                    },
                    title: {
                      type: "string",
                      maxLength: 500,
                      description: "Optional title",
                    },
                    tags: {
                      type: "array",
                      items: { type: "string", maxLength: 100 },
                      maxItems: 20,
                    },
                    meta: {
                      type: "object",
                      additionalProperties: true,
                      description: "Structured metadata (max 10KB serialized)",
                    },
                    source: { type: "string", maxLength: 200 },
                    identity_key: {
                      type: "string",
                      maxLength: 200,
                      description:
                        "Required for entity kinds. Unique identifier for upsert.",
                    },
                    expires_at: {
                      type: "string",
                      format: "date-time",
                      description: "TTL expiry date",
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Entry created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Entry" },
                },
              },
            },
            400: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            401: { description: "Unauthorized" },
            403: { description: "Entry limit reached" },
          },
        },
      },
      "/api/vault/entries/{id}": {
        get: {
          operationId: "getEntry",
          summary: "Get a single entry",
          description:
            "Retrieve a vault entry by its ULID. Use this when you already know the entry ID (e.g. from search results or a previous save).",
          tags: ["Entries"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Entry ULID",
            },
          ],
          responses: {
            200: {
              description: "Entry details",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Entry" },
                },
              },
            },
            404: { description: "Entry not found" },
          },
        },
        put: {
          operationId: "updateEntry",
          summary: "Update an existing entry",
          description:
            "Partially update a vault entry. Only include fields you want to change — omitted fields are preserved. You cannot change kind or identity_key; delete and re-create instead. Meta fields are shallow-merged (new keys override, others preserved).",
          tags: ["Entries"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Entry ULID",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string", maxLength: 500 },
                    body: { type: "string", maxLength: 102400 },
                    tags: {
                      type: "array",
                      items: { type: "string" },
                      maxItems: 20,
                    },
                    meta: { type: "object", additionalProperties: true },
                    source: { type: "string", maxLength: 200 },
                    expires_at: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Updated entry",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Entry" },
                },
              },
            },
            400: { description: "Validation error or invalid update" },
            404: { description: "Entry not found" },
          },
        },
        delete: {
          operationId: "deleteEntry",
          summary: "Delete an entry",
          description:
            "Permanently delete a vault entry. Removes the markdown file from disk, the database row, and the vector embedding. This cannot be undone.",
          tags: ["Entries"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Entry ULID",
            },
          ],
          responses: {
            200: {
              description: "Entry deleted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      deleted: { type: "boolean" },
                      id: { type: "string" },
                      kind: { type: "string" },
                      title: { type: ["string", "null"] },
                    },
                  },
                },
              },
            },
            404: { description: "Entry not found" },
          },
        },
      },
      "/api/vault/search": {
        post: {
          operationId: "searchVault",
          summary: "Search the vault",
          description:
            "Use this as your PRIMARY way to find information. Performs hybrid search combining full-text (FTS5) and semantic vector similarity. Results are ranked by combined relevance score. Event entries decay in relevance over time (configurable). Always try search first before browsing with the list endpoint.",
          tags: ["Search"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["query"],
                  properties: {
                    query: {
                      type: "string",
                      minLength: 1,
                      description: "Natural language search query",
                      example: "how does caching work",
                    },
                    kind: {
                      type: "string",
                      description: "Filter to specific kind",
                    },
                    category: {
                      type: "string",
                      enum: ["knowledge", "entity", "event"],
                    },
                    since: { type: "string", format: "date-time" },
                    until: { type: "string", format: "date-time" },
                    limit: {
                      type: "integer",
                      minimum: 1,
                      maximum: 100,
                      default: 20,
                    },
                    offset: { type: "integer", minimum: 0, default: 0 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Search results ranked by relevance",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      results: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SearchResult" },
                      },
                      count: { type: "integer" },
                      query: { type: "string" },
                    },
                  },
                },
              },
            },
            400: { description: "Missing or invalid query" },
          },
        },
      },
      "/api/vault/status": {
        get: {
          operationId: "getVaultStatus",
          summary: "Vault diagnostics",
          description:
            "Get vault health information: entry counts by kind and category, database size, embedding coverage, and any issues. Use this to verify the vault is working correctly or to check usage stats.",
          tags: ["Status"],
          responses: {
            200: {
              description: "Vault status and diagnostics",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      entries: {
                        type: "object",
                        properties: {
                          total: { type: "integer" },
                          by_kind: {
                            type: "object",
                            additionalProperties: { type: "integer" },
                          },
                          by_category: {
                            type: "object",
                            additionalProperties: { type: "integer" },
                          },
                        },
                      },
                      files: {
                        type: "object",
                        properties: {
                          total: { type: "integer" },
                          directories: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                name: { type: "string" },
                                count: { type: "integer" },
                              },
                            },
                          },
                        },
                      },
                      database: {
                        type: "object",
                        properties: {
                          size: { type: "string" },
                          size_bytes: { type: "integer" },
                          stale_paths: { type: "integer" },
                          expired: { type: "integer" },
                        },
                      },
                      embeddings: {
                        type: ["object", "null"],
                        properties: {
                          indexed: { type: "integer" },
                          total: { type: "integer" },
                          missing: { type: "integer" },
                        },
                      },
                      embed_model_available: { type: ["boolean", "null"] },
                      health: { type: "string", enum: ["ok", "degraded"] },
                      errors: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
