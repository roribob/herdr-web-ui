import { describe, expect, it } from "bun:test";
import { OpenCode } from "@opencode/client";
import type { HerdrPane } from "../shared/protocol.ts";
import { opencodeConversation, opencodeSessionID, opencodeToolOutput } from "./opencode.ts";

const pane = {
  pane_id: "w1:p1", agent: "opencode", cwd: "/workspace",
  agent_session: { agent: "opencode", kind: "id", source: "native", value: "ses_one" },
} as HerdrPane;
const user = { id: "msg_user", type: "user", time: { created: 1000 }, text: "hello" };
const assistant = {
  id: "msg_answer", type: "assistant", agent: "build", model: { providerID: "openai", id: "test" },
  time: { created: 2000 }, content: [{ type: "text", text: "answer" }],
};

/** Real generated client against an isolated HTTP fixture; no local service or Herdr access. */
function fixture() {
  const state = { messages: [assistant, user] as unknown[], next: null as string | null, revert: undefined as unknown, fail: false, requests: [] as string[] };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const url = new URL(request.url);
      state.requests.push(`${request.method} ${url.pathname}${url.search}`);
      if (request.headers.get("authorization") !== "Bearer server-secret") return new Response(null, { status: 401 });
      if (state.fail) return new Response(null, { status: 503 });
      if (url.pathname === "/api/session/ses_one") return Response.json({ data: { id: "ses_one", model: assistant.model, revert: state.revert } });
      if (url.pathname === "/api/session/ses_one/message") return Response.json({ data: state.messages, cursor: { next: state.next } });
      if (url.pathname === "/api/session/ses_one/message/msg_answer") return Response.json({ data: state.messages.find((message) => (message as { id: string }).id === "msg_answer") });
      return new Response(null, { status: 404 });
    },
  });
  const connection = { url: server.url.toString(), client: OpenCode.make({ baseUrl: server.url.toString(), headers: { authorization: "Bearer server-secret" } }) };
  return { state, server, discover: async () => connection };
}

describe("OpenCode V2 read-only adapter", () => {
  it("requires exact native session identity before discovering a server", async () => {
    let calls = 0;
    const discover = async () => { calls++; return null; };
    expect(await opencodeConversation({ ...pane, agent_session: null }, discover)).toBeNull();
    expect(calls).toBe(0);
    expect(opencodeSessionID({ ...pane, agent_session: { ...pane.agent_session!, kind: "path" } })).toBeNull();
    expect(opencodeSessionID({ ...pane, agent_session: { ...pane.agent_session!, value: "../../ses_one" } })).toBeNull();
    expect(opencodeSessionID({ ...pane, agent_session: { ...pane.agent_session!, agent: "claude" } })).toBeNull();
  });

  it("uses authenticated V2 routes, chronological turns and stable ETags", async () => {
    const { server, state, discover } = fixture();
    try {
      const first = await opencodeConversation(pane, discover);
      expect(first?.source).toBe("opencode-api");
      expect(first?.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
      expect(first?.metadata?.model).toBe("openai/test");
      expect((await opencodeConversation(pane, discover))?.version).toBe(first?.version);
      state.messages[0] = { ...assistant, content: [{ type: "text", text: "changed" }] };
      const updated = await opencodeConversation(pane, discover);
      expect(updated?.version).not.toBe(first?.version);
      expect(updated?.history_id).toBe(first?.history_id);
      state.revert = { messageID: "msg_user" };
      expect((await opencodeConversation(pane, discover))?.history_id).not.toBe(first?.history_id);
      expect(state.requests.some((request) => request.includes("limit=200"))).toBe(true);
      expect(state.requests.every((request) => request.startsWith("GET "))).toBe(true);
    } finally { server.stop(true); }
  });

  it("drops partial leading work and falls back if no complete prompt fits", async () => {
    const { server, state, discover } = fixture();
    try {
      state.next = "older";
      state.messages.push({ ...assistant, id: "msg_old" });
      expect((await opencodeConversation(pane, discover))?.turns).toHaveLength(2);
      state.messages = [assistant];
      expect(await opencodeConversation(pane, discover)).toBeNull();
    } finally { server.stop(true); }
  });

  it("keeps unavailable services and missing sessions on fallback", async () => {
    const { server, state, discover } = fixture();
    try {
      expect(await opencodeConversation(pane, async () => null)).toBeNull();
      state.fail = true;
      expect(await opencodeConversation(pane, discover)).toBeNull();
      state.fail = false;
      expect(await opencodeConversation({ ...pane, agent_session: { ...pane.agent_session!, value: "ses_other" } }, discover)).toBeNull();
    } finally { server.stop(true); }
  });

  it("reads whole tool output only for references in the bound visible history", async () => {
    const { server, state, discover } = fixture();
    try {
      const output = "x".repeat(5000);
      state.messages[0] = { ...assistant, content: [{ type: "tool", id: "call_1", name: "shell", time: { created: 2000 }, state: { status: "completed", input: {}, content: [{ type: "text", text: output }] } }] };
      expect(await opencodeToolOutput(pane, "msg_answer:call_1", discover)).toBe(output);
      expect(await opencodeToolOutput(pane, "msg_answer:other", discover)).toBeNull();
      expect(await opencodeToolOutput(pane, "../../secret", discover)).toBeNull();
      state.messages = [user];
      expect(await opencodeToolOutput(pane, "msg_answer:call_1", discover)).toBeNull();
    } finally { server.stop(true); }
  });
});
