---
title: Compliance Heartbeat
purpose: Monitor repository compliance state and open-PR health
cron: "0 */5 * * * *"
mode: constant
adr: ADR-004 Phase 1
---

# Compliance Heartbeat Instruction

This prompt runs every 5 minutes (constant interval — no adaptive backoff)
and verifies that every open PR satisfies the rules in `CLAUDE.md`
"UNVERHANDELBARE REIHENFOLGE" and `COMPLIANCE-TABLE.md`.

## Steps

1. Read `COMPLIANCE-TABLE.md` from the repository root.
2. Identify rows marked with `❌` or with empty mandatory columns
   (CG / TS / CR / PC / DO).
3. Run `gh pr list --state open --json number,title,headRefName` and match
   each open PR to its compliance row.
4. If an open PR is missing a compliance entry **or** has an incomplete
   row → call `mcp__thinklocal__send_message_to_peer` to your own loopback
   SPIFFE-URI with:
   - subject: `compliance reminder`
   - body: list of missing columns and the PR number
5. Otherwise return silently.

## Constraints

- **Read-only.** Never run git write operations (commit, push, branch, etc.).
- The only side effect allowed is sending a self-addressed inbox message.
- Never escalate beyond the local mesh — no Slack, no email, no GitHub PR
  comment.

## References

- `CLAUDE.md` § "UNVERHANDELBARE REIHENFOLGE"
- `docs/architecture/ADR-004-cron-heartbeat.md` Phase 4
