import type { ModelRef, SessionMessageInfo } from "@opencode/client";
import type { ConversationMetadata, ConversationPart, ConversationTurn } from "../shared/protocol.ts";
import { invokedSkill } from "./skill-activity.ts";
import { toolSummary } from "./transcript-records.ts";
import { trimOutput } from "./tool-output.ts";

export function opencodeMetadata(model?: ModelRef): ConversationMetadata {
  return { model: model ? `${model.providerID}/${model.id}` : null, reasoning_effort: null };
}

/** Project native messages in chronological order, never exposing system instructions. */
export function parseOpencodeMessages(messages: readonly SessionMessageInfo[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const message of messages) {
    const ts = new Date(message.time.created).toISOString();
    if (message.type === "user") {
      turns.push({ role: "user", ts, parts: [{ kind: "text", text: message.text }] });
    } else if (message.type === "compaction" && message.status === "completed") {
      turns.push({ role: "user", ts, parts: [{ kind: "compact", text: message.summary }] });
    } else if (message.type === "assistant") {
      const previous = turns.at(-1);
      const turn: ConversationTurn = previous?.role === "assistant" ? previous : { role: "assistant", ts, parts: [] };
      if (turn !== previous) turns.push(turn);
      turn.end_ts = new Date(message.time.completed ?? message.time.streamed ?? message.time.created).toISOString();
      for (const content of message.content) {
        if (content.type === "text") {
          turn.parts.push({ kind: "text", text: content.text });
        } else if (content.type === "reasoning") {
          turn.parts.push({ kind: "thinking", text: content.text });
        } else {
          const rawInput = "input" in content.state ? content.state.input : {};
          const input = typeof rawInput === "string" ? {} : rawInput;
          const tool: Extract<ConversationPart, { kind: "tool" }> = {
            kind: "tool", name: content.name, summary: toolSummary(content.name, input),
            input: typeof rawInput === "string" ? rawInput : JSON.stringify(input, null, 2), output: "",
          };
          const output = "content" in content.state ? content.state.content?.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") ?? "" : "";
          trimOutput(tool, output, `${message.id}:${content.id}`);
          if (content.state.status === "error") {
            tool.error = true;
            if (!output) tool.output = content.state.error.message;
          }
          const skill = invokedSkill(content.name, input);
          if (skill) {
            tool.skill = { ...skill, status: content.state.status === "error" ? "failed" : content.state.status === "completed" ? "loaded" : "requested" };
          }
          turn.parts.push(tool);
        }
      }
    }
  }
  return turns.filter((turn) => turn.parts.length > 0);
}
