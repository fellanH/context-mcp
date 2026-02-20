export type BlogPostSection = {
  heading: string;
  paragraphs: string[];
};

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  category: "Integration" | "Playbook" | "Architecture" | "Education" | "Comparison";
  publishedAt: string;
  readTimeMinutes: number;
  ctaLabel: string;
  ctaHref: string;
  sections: BlogPostSection[];
};

export const posts: BlogPost[] = [
  {
    slug: "designing-kinds-tags-folders-for-long-term-memory-quality",
    title: "Designing Kinds, Tags, and Folders for Long-Term Memory Quality",
    description:
      "How to structure your vault taxonomy so retrieval stays precise as your knowledge base grows from dozens to thousands of entries.",
    category: "Education",
    publishedAt: "2026-02-24",
    readTimeMinutes: 8,
    ctaLabel: "Start free",
    ctaHref: "/register",
    sections: [
      {
        heading: "Why taxonomy decides retrieval quality",
        paragraphs: [
          "A memory system is only as useful as its ability to return the right entry at the right time. When your vault has 50 entries, almost any search works. When it has 500 or 5,000, the difference between a well-structured taxonomy and a flat dump of notes becomes the difference between an agent that finds what it needs on the first query and one that drowns in irrelevant results.",
          "Context Vault organizes entries along three axes: kind, tags, and folders. Each serves a distinct purpose in the retrieval pipeline. Kind determines the structural category of an entry. Tags enable cross-cutting queries that span multiple kinds. Folders provide physical grouping within a kind for project or domain isolation.",
          "Getting this taxonomy right early saves significant rework later. Renaming kinds or restructuring folders after hundreds of entries exist is tedious. The goal of this guide is to help you design a taxonomy that scales cleanly from your first entry to your ten-thousandth.",
        ],
      },
      {
        heading: "Kinds: the primary organizing axis",
        paragraphs: [
          "Every entry in Context Vault has a kind that determines its directory on disk and its behavior during retrieval. The system ships with built-in kinds organized into three categories. Knowledge kinds like insight, decision, pattern, prompt, note, document, and reference are append-only and endure indefinitely. Entity kinds like contact, project, tool, and source are updated in place using an identity key. Event kinds like conversation, message, session, and log have decaying relevance and are automatically time-windowed during search.",
          "The most common mistake is overloading a single kind. Saving everything as a note creates a flat namespace where retrieval cannot distinguish an architectural decision from a debugging observation from a meeting summary. Instead, use the most specific kind that fits. If you made a choice between two approaches and want to remember why, that is a decision. If you discovered a reusable code pattern, that is a pattern. If you learned something surprising about an API, that is an insight.",
          "Custom kinds are supported and default to the knowledge category. If your workflow produces a type of entry that does not fit the built-in kinds, create a new one. A vault focused on content marketing might add kinds like draft or campaign. A vault for research work might add experiment or hypothesis. The system creates the directory automatically on first use.",
          "To verify your kind assignments are working, run a get_context query filtered by kind and check whether the results are coherent. If querying for kind decision returns a mix of decisions and general notes, your kind boundaries need tightening.",
        ],
      },
      {
        heading: "Tags: cross-cutting retrieval filters",
        paragraphs: [
          "Tags are free-form strings attached to any entry regardless of kind. They enable queries that cut across the kind hierarchy. A tag like auth might appear on decisions about authentication architecture, patterns for token refresh logic, and references to OAuth documentation. Searching by that tag returns all three, which is exactly what you want when starting a session focused on the auth system.",
          "Design tags around domains and features, not around time or process stages. Tags like billing, onboarding, api-v2, or postgres are durable and useful for retrieval months later. Tags like sprint-12, tuesday-standup, or wip are ephemeral and quickly become noise. If you need temporal filtering, use the since and until parameters on get_context instead of encoding dates into tags.",
          "Keep your tag vocabulary small and consistent. A vault with 200 unique tags across 500 entries is harder to query than one with 30 well-chosen tags. Before creating a new tag, check whether an existing one covers the same ground. Use list_context with a tags filter to see what is already in use. Singular forms are easier to keep consistent than plurals — use api rather than apis, test rather than tests.",
          "Tags also serve as the primary filter for the list_context tool, which browses entries without a search query. When an agent calls list_context with tags set to [\"payments\"], it gets every entry tagged with payments regardless of kind. This makes tags the most flexible retrieval dimension in the system.",
        ],
      },
      {
        heading: "Folders: physical grouping within kinds",
        paragraphs: [
          "The folder parameter on save_context creates subdirectories within a kind's directory. An insight saved with folder set to react/hooks lands at ~/vault/knowledge/insights/react/hooks/ on disk. This provides physical separation without affecting search behavior — all insights are still indexed together and searchable as a single kind.",
          "Folders are most useful for project isolation and domain namespacing. If you maintain a vault that spans multiple projects, folders prevent file collisions and make it easy to browse entries by project in a file manager or git diff. A pattern saved with folder set to client-a/api stays physically separate from one in client-b/api, even though both are patterns and both appear in search results.",
          "Do not over-nest folders. One or two levels of depth covers most use cases. A structure like react/hooks or project-name/backend is clear and navigable. A structure like work/2026/q1/client-a/backend/auth/tokens is fragile, hard to remember, and provides no retrieval benefit since search does not use folder paths. If you need that level of granularity, use tags instead.",
          "For a practical walkthrough of folder isolation across client projects, see our guide on building an AI dev memory system for client work (/blog/ai-dev-memory-system-client-work). The one-vault-per-client pattern described there maps directly to the folder parameter.",
        ],
      },
      {
        heading: "Categories: the behavioral layer you rarely touch directly",
        paragraphs: [
          "Behind kinds sits a category layer that controls write semantics and retrieval behavior. The three categories are knowledge (append-only, enduring), entity (upsert by identity key, enduring), and event (append-only, decaying relevance). You almost never need to set category manually — it is inferred from the kind. Saving a decision automatically assigns the knowledge category. Saving a contact assigns entity. Saving a session assigns event.",
          "The category distinction matters most for events. When you search without specifying a time range, event-category entries are automatically windowed to the last 30 days by default. This prevents old session logs and conversation snippets from crowding out current results. Knowledge and entity entries have no such decay — a decision made six months ago surfaces with the same priority as one made yesterday, ranked by relevance to the query.",
          "If you create a custom kind and want it to behave like an event with time-windowed retrieval, the system defaults custom kinds to knowledge. For event-like behavior, you would need to add the kind to the category mapping in the source. In practice, most custom kinds are knowledge-type entries, so the default is correct for the majority of cases.",
        ],
      },
      {
        heading: "Related guides",
        paragraphs: [
          "For a deeper look at how the retrieval pipeline ranks results using hybrid full-text and semantic search, see our post on hybrid search for agent memory quality (/blog/hybrid-search-for-agent-memory-quality). Good taxonomy and good retrieval are two sides of the same coin — well-structured entries make the ranking algorithm's job easier, and strong ranking compensates for minor inconsistencies in tagging.",
          "For a practical walkthrough of applying this taxonomy to real multi-project work, see building an AI dev memory system for client work (/blog/ai-dev-memory-system-client-work). That guide shows how kinds, tags, and folders come together in a daily workflow across multiple client projects.",
        ],
      },
      {
        heading: "Building a taxonomy that lasts",
        paragraphs: [
          "Start with the built-in kinds and resist the urge to create custom kinds in your first week. The default set — insight, decision, pattern, and reference — covers the majority of developer knowledge. Add custom kinds only when you find yourself consistently miscategorizing entries or when a new kind would make a frequent retrieval query more precise.",
          "Audit your taxonomy monthly. Run list_context without filters and scan the results. Look for kinds with only one or two entries — they may be better merged into a broader kind. Look for tags that appear on more than half your entries — they are too generic to be useful as filters. Look for folders that contain a single file — the nesting is not earning its keep.",
          "The strongest signal that your taxonomy is working is retrieval precision. When you run get_context with a natural language query and the first result is the entry you were looking for, the taxonomy is serving its purpose. When the first result is noise, trace backward: was the kind too broad, the tags too generic, or the entry title too vague? Fix the taxonomy at the source and the retrieval quality follows.",
          "A well-designed taxonomy turns your vault from a pile of saved text into a structured knowledge base that compounds in value over time. Each new entry strengthens the system rather than diluting it. That is the foundation for an agent memory layer that stays useful as it scales — and the foundation for workflows that get faster, not slower, as your vault grows.",
        ],
      },
    ],
  },
  {
    slug: "solo-founders-prevent-context-loss-across-sessions",
    title: "How Solo Founders Prevent Context Loss Across Sessions",
    description:
      "Practical strategies for solo founders to eliminate the context tax that kills productivity when working with AI tools across sessions.",
    category: "Playbook",
    publishedAt: "2026-02-21",
    readTimeMinutes: 7,
    ctaLabel: "Start free",
    ctaHref: "/register",
    sections: [
      {
        heading: "The solo founder context tax",
        paragraphs: [
          "Every time you open a new AI session, the clock resets. The architectural decisions you made yesterday, the debugging insight from this morning, the API quirk you discovered last week — all gone. You spend 15-30 minutes re-explaining before any real work happens.",
          "For solo founders, this context tax is uniquely painful. There is no teammate who remembers the conversation. No shared Slack thread to reference. You are the single point of failure for all project knowledge, and your AI assistant starts fresh every time.",
          "Across three or four sessions per day, context rebuilding consumes an hour or more of your most productive time. That is time not spent shipping features, talking to customers, or making decisions that move the business forward.",
        ],
      },
      {
        heading: "Capture decisions at the moment of clarity",
        paragraphs: [
          "The best time to save context is during active problem-solving, not after. When you have just resolved a tricky bug or made an architectural choice, the reasoning is fresh and complete. Waiting until the end of a session means details fade and rationale gets lost.",
          "Use specific kinds to categorize what you save. Decisions capture the why behind a choice. Patterns capture reusable approaches you want to apply again. Insights capture surprising discoveries or non-obvious behavior. This taxonomy makes retrieval precise instead of noisy.",
          "Tag entries by domain area, not by session date. Tags like auth, payments, or onboarding-flow are far more useful for future retrieval than session-2026-02-20. Your future self will search by topic, not by when something happened.",
        ],
      },
      {
        heading: "Retrieve before you re-explain",
        paragraphs: [
          "Start each session with a targeted get_context query for the area you plan to work on. This primes your AI with the most relevant prior decisions and patterns before you type a single instruction. The context is already there.",
          "Build retrieval habits per project. If you are working on the billing system, query for billing and payments context first. If you are debugging an API integration, pull up prior insights tagged with that service name. Consistency compounds — each session gets faster.",
          "Measure time-to-productive-output. Track how long it takes from opening a session to doing real work. With a well-maintained vault, this drops from 15 minutes to under two. That is the clearest signal that your memory system is working.",
        ],
      },
      {
        heading: "Scaling the system as you grow",
        paragraphs: [
          "When you eventually hire, your vault becomes an onboarding tool. New team members can query the same decisions, patterns, and context that you accumulated over months of solo building. The knowledge transfers without you being in the room.",
          "Separate personal entries from project entries early. Personal insights about your workflow and preferences belong in a different space than project-specific architectural decisions. This separation keeps both sets clean as the team grows.",
          "Prune quarterly for quality over quantity. Review entries that never surface in search results or that reference outdated decisions. A smaller vault with high-quality, current entries outperforms a large one full of stale context. Delete aggressively and trust that the important patterns will be re-captured if they are still relevant.",
        ],
      },
    ],
  },
  {
    slug: "using-mcp-memory-with-gpt-actions",
    title: "Using MCP Memory with GPT Actions",
    description:
      "Connect Context Vault to ChatGPT via GPT Actions for persistent memory across AI tools. Same vault serves Claude Code, Cursor, and ChatGPT.",
    category: "Integration",
    publishedAt: "2026-02-20",
    readTimeMinutes: 7,
    ctaLabel: "Start free",
    ctaHref: "/register",
    sections: [
      {
        heading: "Why ChatGPT needs external memory",
        paragraphs: [
          "ChatGPT conversations are ephemeral by design. Even with conversation history, there is no structured way to retrieve a specific decision you made three weeks ago or a pattern you discovered across multiple sessions. Memory features exist but are limited and opaque.",
          "GPT Actions bridge this gap by connecting ChatGPT to external APIs. A Custom GPT can call any authenticated endpoint, which means it can interact with the same Context Vault that serves your Claude Code and Cursor sessions.",
          "The result is a single vault that works across all your AI tools. Save a decision in Claude Code, retrieve it in ChatGPT. Capture a pattern in Cursor, surface it in a Custom GPT. One memory layer, multiple clients, zero duplication.",
        ],
      },
      {
        heading: "How GPT Actions connect to Context Vault",
        paragraphs: [
          "Create a Custom GPT and configure it with a GPT Action pointing at your hosted Context Vault MCP endpoint. The action uses API key authentication — paste your Context Vault API key as the bearer token in the action auth settings.",
          "Define three core actions that map to Context Vault tools: save_context for writing new entries, get_context for hybrid search and retrieval, and context_status for verifying the connection is healthy. Each action maps directly to the MCP tool schema.",
          "Once configured, the Custom GPT can save and retrieve context using natural language. Ask it to remember a decision and it calls save_context. Ask it what you decided about authentication last week and it calls get_context with the right query.",
        ],
      },
      {
        heading: "Building a cross-client memory workflow",
        paragraphs: [
          "The power of a shared vault is cross-client retrieval. Save an architectural decision during a Claude Code session, then pull it up in ChatGPT when explaining the system to a colleague. The entry exists once, accessible everywhere.",
          "Tags and kinds stay consistent across all clients. Whether you save via MCP in Claude Code or via GPT Actions in ChatGPT, the same taxonomy applies. This consistency is what makes cross-client search reliable — the same query returns the same results regardless of which tool you use.",
          "Latency stays under 200ms for hosted retrieval. GPT Actions add a small overhead for the HTTP round-trip, but the actual search and response time from Context Vault is fast enough that the Custom GPT experience feels native.",
        ],
      },
      {
        heading: "Limitations and workarounds",
        paragraphs: [
          "GPT Actions have rate limits and payload size constraints that vary by plan. Plus, Team, and Enterprise accounts get higher limits. Free-tier ChatGPT does not support Custom GPTs with actions, so this workflow requires a paid OpenAI plan.",
          "Start with read-only access before enabling writes. Configure your Custom GPT with only the get_context action first. Once you are confident in the retrieval workflow, add save_context. This reduces the risk of accidentally saving low-quality entries from casual ChatGPT conversations.",
          "Large vault responses may hit payload limits. If your search returns many results, use the limit parameter in get_context to cap the response size. Five to ten results is usually enough context for ChatGPT to work with effectively.",
        ],
      },
    ],
  },
  {
    slug: "ai-dev-memory-system-client-work",
    title: "Build an AI Dev Memory System for Client Work",
    description:
      "A practical playbook for using persistent AI memory across multiple client projects without context bleed.",
    category: "Playbook",
    publishedAt: "2026-02-19",
    readTimeMinutes: 7,
    ctaLabel: "Start free",
    ctaHref: "/register",
    sections: [
      {
        heading: "The client work context problem",
        paragraphs: [
          "Switching between client projects means rebuilding mental context every time you open a session. The architectural decisions from last week's call are gone. The API quirks you discovered on Tuesday vanish by Thursday.",
          "This is worse for AI-assisted development because your AI assistant starts completely fresh each session. You end up re-explaining project constraints, tech stack choices, and client preferences before any real work happens.",
          "The cost compounds across clients. Three active projects means three separate context rebuilds per day, each burning 10-15 minutes of expensive AI conversation time on orientation instead of output.",
        ],
      },
      {
        heading: "One vault per client",
        paragraphs: [
          "The simplest isolation pattern is one vault folder per client project. Each vault contains only that client's decisions, patterns, and references. No cross-contamination, no accidental leakage of one client's architecture into another's codebase.",
          "Tag entries with the project name, current phase, and decision type. A typical client vault might use kinds like decision, pattern, and reference with tags for the specific domain area. This structure scales cleanly from a solo freelancer to a small team.",
          "Keep client data isolated by default. When you find a generalizable pattern that applies across projects, save it to a personal vault with a generic tag rather than duplicating it across client vaults.",
        ],
      },
      {
        heading: "Workflow: capture during, retrieve before",
        paragraphs: [
          "During a work session, save architectural decisions, API quirks, client preferences, and implementation patterns as they come up. Use save_context with specific titles and relevant tags so future retrieval is precise.",
          "Before starting the next session, retrieve recent entries to prime your AI with relevant context. A single get_context call with the project name returns the most relevant decisions and patterns, weighted by recency.",
          "This creates a virtuous cycle. Each session deposits context that makes the next session faster. After two weeks, session startup drops from 15 minutes of re-explanation to under two minutes of automated context loading.",
        ],
      },
      {
        heading: "Scaling to multiple clients",
        paragraphs: [
          "For three to five active projects, use a consistent folder convention. Each client vault lives in its own directory with the same internal structure: decisions, patterns, references, and session notes organized by kind.",
          "Use kinds to separate content types cleanly. Decisions capture why something was chosen. Patterns capture reusable approaches. References capture external docs, API endpoints, and credentials locations. This taxonomy works across any client project.",
          "When cross-pollinating solutions between clients, search your personal vault for generic patterns rather than searching client vaults directly. This keeps boundaries clean while still benefiting from accumulated experience across all your work.",
        ],
      },
    ],
  },
  {
    slug: "context-vault-cursor-setup-best-practices",
    title: "Context Vault + Cursor: Setup and Best Practices",
    description:
      "Connect Context Vault to Cursor via MCP for persistent memory across coding sessions. Setup guide and daily workflow tips.",
    category: "Integration",
    publishedAt: "2026-02-19",
    readTimeMinutes: 6,
    ctaLabel: "Start free",
    ctaHref: "/register",
    sections: [
      {
        heading: "Why Cursor needs persistent memory",
        paragraphs: [
          "Cursor's AI features are powerful for in-session coding but lack cross-session memory. Every new session starts fresh. The patterns you taught it yesterday, the architectural decisions you explained last week, and the project conventions you clarified are all gone.",
          "Context Vault fills this gap through MCP. By connecting Cursor to a Context Vault endpoint, your AI assistant gains access to a searchable memory layer that persists across every session. Prior decisions, code patterns, and project context are always retrievable.",
          "The result is less repetition and faster ramp-up. Instead of re-explaining your project structure every morning, your AI starts with the context it needs and you jump straight into productive work.",
        ],
      },
      {
        heading: "Setup in under 5 minutes",
        paragraphs: [
          "Install the Context Vault CLI globally with npm install -g context-vault, then run context-vault setup. This creates your local vault directory, downloads the embedding model on first run, and validates that all components are healthy.",
          "Next, configure Cursor's MCP settings to point at the Context Vault endpoint. Open Cursor settings, navigate to the MCP configuration section, and add the context-vault server. For local usage, point to the local MCP endpoint. For hosted, use your API key and the hosted URL.",
          "Verify the connection by running a context_status call from Cursor's AI chat. If it returns your vault path and entry count, you are connected and ready to start saving context.",
        ],
      },
      {
        heading: "Best practices for daily use",
        paragraphs: [
          "Use save_context after meaningful decisions or discoveries during each session. Good candidates include architectural choices, debugging insights, API behavior quirks, and resolved ambiguities. Keep entries focused with one insight per entry rather than dumping entire session logs.",
          "Design your kinds and tags around your project structure. Start simple with three or four kinds like decision, pattern, and reference. Add tags for the specific area of the codebase or feature domain. Consistent tagging makes retrieval dramatically more precise.",
          "At the start of each session, use get_context with a query relevant to your planned work. This primes Cursor's AI with the most relevant prior context. Over time this becomes automatic and the AI surfaces the right context without you needing to think about what to retrieve.",
        ],
      },
      {
        heading: "Measuring value",
        paragraphs: [
          "Track whether the first search result from get_context is useful. If the top result answers your question or provides relevant context more than 70 percent of the time, your memory system is working well. Below that threshold, refine your tagging and entry granularity.",
          "Prune low-value entries periodically. Entries that never surface in search results or that contain outdated information add noise without value. A smaller vault with high-quality entries outperforms a large vault full of stale context.",
          "The strongest signal is session startup time. If you are spending less time re-explaining context and more time in productive coding, the memory layer is delivering value regardless of any other metric.",
        ],
      },
    ],
  },
  {
    slug: "context-vault-claude-code-5-minute-setup",
    title: "Context Vault + Claude Code: 5-Minute Setup",
    description:
      "Install Context Vault, connect Claude Code over MCP, and verify your first persistent memory workflow.",
    category: "Integration",
    publishedAt: "2026-02-19",
    readTimeMinutes: 6,
    ctaLabel: "Start free",
    ctaHref: "/register",
    sections: [
      {
        heading: "Why this workflow matters",
        paragraphs: [
          "Most coding sessions restart context from scratch. Persistent memory removes repeated prompting and makes follow-up tasks faster.",
          "Context Vault gives Claude Code a reliable MCP memory layer so prior decisions, notes, and patterns are available across sessions.",
        ],
      },
      {
        heading: "Setup flow",
        paragraphs: [
          "Install the CLI globally and run setup. This configures your local vault, downloads embeddings, and validates tool health.",
          "Then connect your client with one MCP endpoint and verify your first tool call using context_status, followed by save_context and get_context.",
        ],
      },
      {
        heading: "Production checklist",
        paragraphs: [
          "Use one canonical MCP endpoint, keep your vault folder under version control where appropriate, and monitor first-run activation events.",
          "The highest-leverage metric is register to first successful get_context in under three minutes.",
        ],
      },
    ],
  },
  {
    slug: "moving-from-local-vault-to-hosted-without-lock-in",
    title: "Move From Local Vault To Hosted Without Lock-In",
    description:
      "A practical migration pattern to keep markdown portability while enabling managed hosted access.",
    category: "Playbook",
    publishedAt: "2026-02-18",
    readTimeMinutes: 7,
    ctaLabel: "See 2-minute setup",
    ctaHref:
      "https://github.com/fellanH/context-vault/blob/main/docs/distribution/connect-in-2-minutes.md",
    sections: [
      {
        heading: "Keep your source of truth portable",
        paragraphs: [
          "Context Vault stores knowledge in markdown with YAML frontmatter. That gives you human-readable files and straightforward export behavior.",
          "Hosted usage adds convenience and distribution without forcing a proprietary store format.",
        ],
      },
      {
        heading: "Migration pattern",
        paragraphs: [
          "Keep the same information architecture (kind, tags, folder conventions) while introducing hosted auth and API key management.",
          "Validate retrieval quality after migration by sampling representative get_context queries and comparing top results.",
        ],
      },
      {
        heading: "What to measure",
        paragraphs: [
          "Track adoption by API key copy, first MCP call, first write, and first successful retrieval. These are stronger indicators than pageview metrics.",
          "If retrieval quality drops, tune kind granularity and recency behavior before expanding content volume.",
        ],
      },
    ],
  },
  {
    slug: "hybrid-search-for-agent-memory-quality",
    title: "Hybrid Search Is The Core Of Agent Memory Quality",
    description:
      "Why full-text + semantic retrieval with recency weighting matters when your memory corpus grows.",
    category: "Architecture",
    publishedAt: "2026-02-17",
    readTimeMinutes: 8,
    ctaLabel: "Start free",
    ctaHref: "/register",
    sections: [
      {
        heading: "Storage is not the hard part",
        paragraphs: [
          "The hard problem is returning the right five entries from thousands. Irrelevant retrieval wastes context window budget and hurts trust.",
          "Hybrid ranking balances exact keyword matching with semantic similarity so both explicit terms and intent are captured.",
        ],
      },
      {
        heading: "Recency and relevance",
        paragraphs: [
          "Session notes and architectural decisions age differently. A strong retrieval system accounts for these data lifecycles.",
          "Recency weighting should support freshness without burying durable decisions and patterns.",
        ],
      },
      {
        heading: "Operational guidance",
        paragraphs: [
          "Treat retrieval metrics as product metrics. Evaluate first-result usefulness, not only latency.",
          "Use periodic relevance checks to keep quality stable as your vault scales from hundreds to thousands of entries.",
        ],
      },
    ],
  },
];

export function getPostBySlug(slug?: string) {
  return posts.find((post) => post.slug === slug);
}
