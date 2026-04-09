---
title: Inbox Heartbeat
purpose: Adaptive polling of peer-to-peer messages via thinklocal-mcp
cron: "*/5 * * * * *"
mode: lan
adr: ADR-004 Phase 1
---

# Inbox Heartbeat Instruction

This is the prompt body that the agent's harness scheduler runs on every
heartbeat tick. Keep it minimal — every tick costs context.

## Steps

1. Call `mcp__thinklocal__unread_messages_count()`.
2. If the count is `0`: return immediately. Produce no output, no logs.
3. If the count is `> 0`:
   a. Call `mcp__thinklocal__read_inbox(unread_only: true)`.
   b. For each message: decide whether a reply is necessary.
   c. Call `mcp__thinklocal__mark_message_read(message_id)` for every processed message.
4. If a reply is required: call `mcp__thinklocal__send_message_to_peer`
   targeting the `from_agent` of the original message.

## Constraints

- No echo, no acknowledgements, no status updates on idle ticks.
- Minimal context consumption — early-return on empty inbox is mandatory.
- Silent exit on errors (a daemon being offline is the normal case when
  not all peers are running).

## References

- `docs/architecture/ADR-004-cron-heartbeat.md`
- `thinklocal heartbeat show` — print this prompt directly from the CLI
