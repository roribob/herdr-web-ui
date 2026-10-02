import { createHash } from "node:crypto";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { Service } from "@opencode/client/service";
import type { ConversationResponse, HerdrPane } from "../shared/protocol.ts";
import { opencodeMetadata, parseOpencodeMessages } from "./opencode-records.ts";

type Client = Pick<OpenCodeClient, "session" | "message">;
export type OpencodeConnection = { client: Client; url: string };
type Connect = () => Promise<OpencodeConnection | null>;

/** Discovery is read-only: viewing chat must never start or replace a service. */
async function connect(): Promise<OpencodeConnection | null> {
  const endpoint = await Service.discover({ version: (version) => version.startsWith("2.") });
  if (!endpoint) return null;
  return { client: OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) }), url: endpoint.url };
}

/** Exact Herdr-reported identity only. No cwd, terminal-text or newest-session guesses. */
export function opencodeSessionID(pane: HerdrPane): string | null {
  const session = pane.agent_session;
  return session?.agent === "opencode" && session.kind === "id" && /^ses[A-Za-z0-9_-]{1,125}$/.test(session.value) ? session.value : null;
}

export type OpencodeConversation = ConversationResponse & { source: "opencode-api"; version: string; history_id: string };

/** First slice: bounded newest history; native pagination will be adapted separately. */
export async function opencodeConversation(pane: HerdrPane, discover: Connect = connect): Promise<OpencodeConversation | null> {
  const sessionID = opencodeSessionID(pane);
  if (!sessionID) return null;
  try {
    const connection = await discover();
    if (!connection) return null;
    const { client, url } = connection;
    const options = { signal: AbortSignal.timeout(5000) };
    const [session, page] = await Promise.all([
      client.session.get({ sessionID }, options),
      client.message.list({ sessionID, order: "desc", limit: 200 }, options),
    ]);
    if (session.id !== sessionID) return null;
    // The first retained assistant step may belong to a prompt outside this window.
    const messages = [...page.data].reverse();
    const start = page.cursor.next ? messages.findIndex((message) => message.type === "user") : 0;
    if (start < 0) return null;
    const turns = parseOpencodeMessages(messages.slice(start));
    const history_id = digest([url, sessionID, session.revert ?? null]);
    const metadata = opencodeMetadata(session.model ?? [...messages].reverse().find((message) => message.type === "assistant")?.model);
    const answer = { source: "opencode-api" as const, history_id, turns, metadata };
    return { ...answer, version: digest(answer) };
  } catch {
    // Missing identity/service, V1, authentication and transport failures retain scrollback.
    // Do not leak service credentials or remote error payloads to the browser.
    return null;
  }
}

export async function opencodeToolOutput(pane: HerdrPane, ref: string, discover: Connect = connect): Promise<string | null> {
  const sessionID = opencodeSessionID(pane);
  const match = /^(msg_[A-Za-z0-9_-]+):([A-Za-z0-9_.-]+)$/.exec(ref);
  if (!sessionID || !match) return null;
  try {
    const connection = await discover();
    if (!connection) return null;
    // Only the currently projected history can authorize a lazy output read.
    const conversation = await opencodeConversation(pane, async () => connection);
    if (!conversation?.turns.some((turn) => turn.parts.some((part) => part.kind === "tool" && part.output_ref === ref))) return null;
    const message = await connection.client.session.message.get({ sessionID, messageID: match[1]! }, { signal: AbortSignal.timeout(5000) });
    if (message.type !== "assistant") return null;
    const tool = message.content.find((part) => part.type === "tool" && part.id === match[2]);
    if (!tool || tool.type !== "tool" || !("content" in tool.state)) return null;
    return (tool.state.content?.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") ?? "").slice(0, 2_000_000);
  } catch { return null; }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 22);
}
