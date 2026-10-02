import { describe, expect, it } from "bun:test";
import type { SessionMessageInfo } from "@opencode/client";
import { opencodeMetadata, parseOpencodeMessages } from "./opencode-records.ts";

const user: SessionMessageInfo = { id: "msg_user", type: "user", time: { created: 1000 }, text: "hello" };
const assistant: Extract<SessionMessageInfo, { type: "assistant" }> = {
  id: "msg_answer", type: "assistant", agent: "build", model: { providerID: "openai", id: "gpt-6" },
  time: { created: 2000, completed: 3000 }, content: [{ type: "text", text: "answer" }],
};

describe("OpenCode V2 message projection", () => {
  it("merges assistant steps and excludes system and synthetic messages", () => {
    const hidden: SessionMessageInfo = { id: "msg_hidden", type: "system", time: { created: 0 }, text: "private instructions" };
    const turns = parseOpencodeMessages([hidden, user, assistant, { ...assistant, id: "msg_next", content: [{ type: "reasoning", text: "thinking" }] }]);
    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(turns[1]?.parts).toEqual([{ kind: "text", text: "answer" }, { kind: "thinking", text: "thinking" }]);
    expect(turns[1]?.end_ts).toBe(new Date(3000).toISOString());
  });

  it("keeps completed compaction summaries", () => {
    const compact: SessionMessageInfo = { id: "msg_compact", type: "compaction", time: { created: 4000 }, status: "completed", reason: "manual", summary: "summary", recent: "recent" };
    expect(parseOpencodeMessages([compact])[0]?.parts).toEqual([{ kind: "compact", text: "summary" }]);
  });

  it("projects tools and bounds output with a message-scoped reference", () => {
    const message = { ...assistant, content: [{ type: "tool" as const, id: "call_1", name: "shell", time: { created: 2000 }, state: { status: "completed" as const, input: { command: "pwd" }, content: [{ type: "text" as const, text: "x".repeat(5000) }] as [{ type: "text"; text: string }] } }] };
    expect(parseOpencodeMessages([message])[0]?.parts[0]).toMatchObject({ kind: "tool", name: "shell", output_ref: "msg_answer:call_1", output_size: 5000 });
  });

  it("does not equate model variants with reasoning effort", () => {
    expect(opencodeMetadata({ providerID: "openai", id: "gpt-6", variant: "fast" })).toEqual({ model: "openai/gpt-6", reasoning_effort: null });
  });
});
