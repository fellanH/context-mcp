# Sales Pipeline

Lightweight CRM for founder-led sales. Targets from `sales-playbook.md` and `funnel-metrics.md`.

---

## Targets (90-Day)

| Metric                  | Target | Current | Gap |
| ----------------------- | ------ | ------- | --- |
| Qualified conversations | 50     | 0       | 50  |
| Activation calls        | 20     | 0       | 20  |
| Direct conversion asks  | 10     | 0       | 10  |

Weekly pace needed (8 active weeks):

- ~6 new conversations/week
- ~3 activation calls/week
- ~1 conversion ask/week

---

## Stage Definitions

| Stage          | Description                                  | Exit criteria                                      |
| -------------- | -------------------------------------------- | -------------------------------------------------- |
| `prospect`     | Identified as potential fit. No contact yet. | First outreach sent.                               |
| `conversation` | Active back-and-forth. Aware of CV.          | Agreed to try CV or see a demo.                    |
| `activated`    | Has registered and made first MCP call.      | Used `save_context` + `get_context` at least once. |
| `asked`        | Directly asked about upgrading to Pro.       | Gave a clear yes, no, or not-yet.                  |
| `converted`    | Paying Pro user.                             | Payment confirmed.                                 |
| `lost`         | Declined or went silent after ask.           | No response after 2 follow-ups.                    |
| `parked`       | Interested but not ready. Revisit later.     | Set a revisit date.                                |

---

## Source Legend

| Code     | Source                            |
| -------- | --------------------------------- |
| X        | Twitter/X DM or reply             |
| HN       | Hacker News thread                |
| Reddit   | Reddit comment or DM              |
| GH       | GitHub issue, discussion, or star |
| Cursor   | Cursor community or forum         |
| Claude   | Claude community or Discord       |
| Inbound  | Came to us via website or docs    |
| Referral | Referred by existing user         |
| PH       | Product Hunt                      |

---

## Pipeline

| #   | Name / Handle | Source | First Contact | Stage    | Last Touch | Next Action | Notes |
| --- | ------------- | ------ | ------------- | -------- | ---------- | ----------- | ----- |
| 1   |               |        |               | prospect |            |             |       |
| 2   |               |        |               | prospect |            |             |       |
| 3   |               |        |               | prospect |            |             |       |
| 4   |               |        |               | prospect |            |             |       |
| 5   |               |        |               | prospect |            |             |       |

<!-- Add rows as conversations start. No emails or private info in git. -->

---

## Weekly Pipeline Review Template

Copy this block into `weekly-log.md` each Friday:

```markdown
### Pipeline Activity (Week N)

- New conversations this week:
- Conversations → activated:
- Activated → asked:
- Asked → converted:
- Contacts parked:
- Contacts lost:
- Total active pipeline:
- Top source this week:
- Key insight:
```
