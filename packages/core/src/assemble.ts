import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hybridSearch } from './search.js';
import { VaultConfig } from './types.js';

export interface AssembleOptions {
  role: 'worker' | 'pm' | 'ceo' | 'steer';
  task: string;
  budget: number;
}

export interface IncludedEntryMeta {
  title: string;
  status: 'full' | 'condensed';
}

export interface AssembleResult {
  markdown: string;
  metadata: {
    tokens_used: number;
    budget: number;
    entries_included: number;
    role: string;
    included_entries: IncludedEntryMeta[];
  };
}

const TOKEN_TO_CHAR_RATIO = 4; // approximate conversion

const CONDENSED_SUFFIX = '\n... [truncated for context budget]';
const CONDENSED_BODY_CHARS = 400;

type RoleProfile = { rules: string[]; skills: string[]; memory: string[] };

const DEFAULT_ROLE_PROFILES: Record<string, RoleProfile> = {
  worker: {
    rules: ['coding', 'patterns', 'standards', 'error-handling', 'debugging'],
    skills: ['git', 'compile', 'test', 'local'],
    memory: ['feedback', 'user', 'project', 'reference']
  },
  pm: {
    rules: ['orchestration', 'planning', 'spec-writing', 'review', 'debugging-escalation'],
    skills: ['dispatch', 'review', 'triage', 'report'],
    memory: ['project', 'team', 'feedback']
  },
  ceo: {
    rules: ['strategy', 'epistemic-honesty', 'decision-making', 'business-logic'],
    skills: ['triage', 'delegate', 'report'],
    memory: ['north-star', 'project', 'user']
  },
  steer: {
    rules: ['steer', 'strategy', 'feedback-loops', 'analysis'],
    skills: ['triage', 'report', 'analyze'],
    memory: ['north-star', 'feedback']
  }
};

function loadRoleProfiles(dataDir: string): Record<string, RoleProfile> {
  const rolesPath = join(dataDir, 'roles.json');
  if (existsSync(rolesPath)) {
    try {
      const raw = readFileSync(rolesPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, RoleProfile>;
      }
    } catch {
      // fall through to defaults
    }
  } else {
    // Seed roles.json with defaults so the user can edit it later
    try {
      writeFileSync(rolesPath, JSON.stringify(DEFAULT_ROLE_PROFILES, null, 2) + '\n');
    } catch {
      // non-fatal: writable failure just means we use in-memory defaults
    }
  }
  return DEFAULT_ROLE_PROFILES;
}

export async function assembleContext(
  db: import('node:sqlite').DatabaseSync,
  config: VaultConfig,
  options: AssembleOptions
): Promise<AssembleResult> {
  const { role, task, budget } = options;

  // 1. Load role profiles (dynamic — falls back to defaults)
  const ROLE_PROFILES = loadRoleProfiles(config.dataDir);
  const profile = ROLE_PROFILES[role] || ROLE_PROFILES.worker || DEFAULT_ROLE_PROFILES.worker;
  const charsBudget = budget * TOKEN_TO_CHAR_RATIO;

  // Allocate slots
  const rulesChars = Math.floor(charsBudget * 0.2); // 20% for rules
  const skillsChars = Math.floor(charsBudget * 0.1); // 10% for skills
  const taskChars = Math.floor(charsBudget * 0.2);   // 20% for task
  const vaultChars = Math.floor(charsBudget * 0.3);  // 30% for dynamically retrieved vault context
  // reserve 20%

  let markdown = `# Assembled Context: ${role.toUpperCase()}\n\n`;
  let totalCharsUsed = markdown.length;

  // 2. Add Task Spec
  const taskSection = `## Active Task\n\n${task}\n\n`;
  markdown += taskSection;
  totalCharsUsed += taskSection.length;

  // 3. Dynamic Vault Retrieval based on task
  let entriesIncluded = 0;
  const includedEntries: IncludedEntryMeta[] = [];
  const totalBudgetChars = vaultChars + taskChars + rulesChars + skillsChars;

  if (vaultChars > 0 && task.trim().length > 0) {
    try {
      // Over-retrieve candidates
      const searchResults = await hybridSearch(
        {
          db,
          config,
          stmts: {} as any,
          insertVec: () => {},
          deleteVec: () => {},
          embed: async () => new Float32Array(384),
          insertCtxVec: () => {},
          deleteCtxVec: () => {}
        },
        task,
        { limit: 20 }
      );

      if (searchResults && searchResults.length > 0) {
        markdown += `## Retrieved Context\n\n`;
        const retrievedHeaderLen = `## Retrieved Context\n\n`.length;
        totalCharsUsed += retrievedHeaderLen;

        for (const item of searchResults) {
          const entry = 'entry' in item ? (item as any).entry : (item as any);
          const fullBody = entry.body || '';
          const titleText = entry.title ? `### ${entry.title}\n` : '';
          const entryTitle = entry.title || '(untitled)';

          const fullEntryMarkdown = `${titleText}${fullBody}\n\n`;

          if (totalCharsUsed + fullEntryMarkdown.length <= totalBudgetChars) {
            // Full entry fits
            markdown += fullEntryMarkdown;
            totalCharsUsed += fullEntryMarkdown.length;
            entriesIncluded++;
            includedEntries.push({ title: entryTitle, status: 'full' });
          } else {
            // Try condensed version
            const condensedBody = fullBody.slice(0, CONDENSED_BODY_CHARS) + CONDENSED_SUFFIX;
            const condensedEntryMarkdown = `${titleText}${condensedBody}\n\n`;

            if (totalCharsUsed + condensedEntryMarkdown.length <= totalBudgetChars) {
              markdown += condensedEntryMarkdown;
              totalCharsUsed += condensedEntryMarkdown.length;
              entriesIncluded++;
              includedEntries.push({ title: entryTitle, status: 'condensed' });
            } else {
              // Neither fits — stop adding vault entries
              break;
            }
          }
        }
      }
    } catch (e) {
      console.error("Vault retrieval error during assembly:", e);
    }
  }

  // 4. Construct System Prompts/Rules/Skills
  const rulesSection = `## Role Directives\n\n### Rules\n${profile.rules.join(', ')}\n\n### Skills\n${profile.skills.join(', ')}\n\n`;
  markdown = rulesSection + markdown; // U-Curve: Rules at the top
  totalCharsUsed += rulesSection.length;

  return {
    markdown,
    metadata: {
      tokens_used: Math.ceil(totalCharsUsed / TOKEN_TO_CHAR_RATIO),
      budget,
      entries_included: entriesIncluded,
      role,
      included_entries: includedEntries
    }
  };
}
