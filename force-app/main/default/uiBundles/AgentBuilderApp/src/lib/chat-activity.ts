/**
 * What the chat panel tells the world about a turn, as it happens.
 *
 * The panel owns the conversation; the console rail beside it only
 * narrates. Keeping that narration as a stream of small events means the
 * rail can be swapped, hidden or redesigned without touching the chat
 * logic — and the side-panel variant, which has no rail, ignores them.
 */
export type ChatPhase = 'listen' | 'think' | 'speak' | 'ready';

export type ChatActivity =
  | { kind: 'sys'; text: string; at: number }
  | { kind: 'phase'; phase: ChatPhase; at: number }
  | { kind: 'user'; text: string; how: 'talk' | 'type'; at: number }
  | { kind: 'thinking'; at: number }
  | { kind: 'tool'; name: string; note?: string; at: number }
  | {
      kind: 'reply';
      text: string;
      aloud: boolean;
      tokensIn?: number;
      tokensOut?: number;
      model?: string;
      latencyMs?: number;
      at: number;
    }
  | { kind: 'approval'; at: number }
  | { kind: 'error'; text: string; at: number };

/** An event before it is stamped — what the panel builds; `at` is added on
 *  emit. Distributed over the union, so each kind keeps its own fields
 *  (a plain `Omit` on a union would keep only the shared ones). */
export type ChatActivityInput = ChatActivity extends infer T ? (T extends ChatActivity ? Omit<T, 'at'> : never) : never;
