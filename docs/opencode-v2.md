# OpenCode V2 chat — initial implementation

The bridge can display native OpenCode V2 messages through `@opencode/client`
(pinned to 2.0.22). It discovers an already-running compatible shared service
on the bridge's own machine, using its private authentication headers. Opening
chat does not start, stop, update or replace OpenCode.

## Session identity

Herdr must report `agent_session` with `agent: "opencode"`, `kind: "id"` and the
exact current `ses…` ID. The bridge never selects a session by cwd, timestamps,
terminal text or list order. Missing identity, missing service and failed API
requests retain terminal scrollback. Read-only verification on the implementing
agent's live pane confirmed native Herdr session reporting and an `opencode-api`
response with four turns and the selected model. Session switching still needs
live verification.

Custom servers and standalone instances are not supported by this first slice.
Do not bind those panes to the shared-service adapter; their endpoint and
authentication context need a separate explicit binding mechanism.

## Supported now

- Newest 200 native messages, projected chronologically into existing chat turns.
- Text, reasoning, tool input/results/errors, skill calls and completed compactions.
- Latest selected model; reasoning effort remains unknown rather than being
  inferred from a model variant.
- Existing two-second polling and ETags; session/revert changes reset history.
- Lazy full text tool output, authorized against the bound visible history.
- Existing terminal input transport, unchanged.

System/synthetic messages are not displayed. Partial leading assistant work is
discarded if the oldest prompt falls outside the bounded window; if no prompt
fits, the bridge falls back rather than presenting an empty conversation.

## Remaining work

- Verify session switches against a live V2 pane.
- Adapt native pagination to the chat's `before`/`from`/`since` whole-turn contract.
  This slice intentionally omits `cursor`, so older-history loading is unavailable.
- Native permission/form UI, prompt admission, interrupts and slash commands.
- Attachments/images, model variants and context usage.
- Event streaming with explicit reconnect and snapshot resynchronization.
- Custom/standalone server bindings and desktop/mobile browser QA.

The message API provides no explicit commentary/final-answer phase; this adapter
does not invent one. Live events have no replay or automatic reconnection.

References: [V2 client](https://opencode.ai/v2/docs/build/client),
[V2 API](https://opencode.ai/v2/docs/api),
[V1 migration](https://opencode.ai/v2/docs/migrate-v1).

## Validation

The new projection/HTTP-fixture tests, TypeScript check and production build pass.
The full unit suite also ran: 1037 passed, three skipped, two failed in unchanged
Pi/voice tests (macOS `/var` versus `/private/var` canonicalization and an expected
`audio.webm` versus actual `clip.webm` filename). These failures were not changed
as part of this feature.
