// Cairn repeater — inbound control-command predicate.
//
// Kept deliberately DEPENDENCY-FREE (no import of bridge.ts / forward.ts) so the
// core inbound path can import it without pulling the WebSocket bridge into that
// hot path — and so the single core hook that calls it stays trivial to re-apply
// on any upstream merge.
//
// André manages Cairn's ECHO state transparently by typing bare @echo commands in
// the Rain Tech Group. Each agent (Rain/Tio/Cairn) is a separate bot that receives
// group messages directly from Telegram, so a control command would otherwise
// trigger Rain and Tio too. This predicate lets the core inbound gate drop those
// commands for every agent EXCEPT the Cairn repeater — which still receives them
// (its extension acts on them and reports state), keeping the whole ECHO control
// loop invisible to the other agents' context.

/** Registered Cairn repeater agent id. Mirrors CAIRN_AGENT_ID in forward.ts —
 * duplicated (not imported) to keep this module dependency-free for core. */
const CAIRN_AGENT_ID = "cairn";

/** A bare @echo control command — the whole message is just the token. */
const ECHO_CONTROL_RE = /^@echo_(on|off|status)$/i;

/**
 * True if this inbound message is a bare Cairn ECHO control command AND the
 * receiving agent is NOT the Cairn repeater — so it should be suppressed (no
 * agent run), keeping it out of Rain's/Tio's context. Cairn's own bot returns
 * false here, so the repeater still receives and handles it.
 */
export function isPeerEchoControlToSuppress(
  agentId: string | null | undefined,
  text: string | null | undefined,
): boolean {
  if (!text || agentId === CAIRN_AGENT_ID) {
    return false;
  }
  return ECHO_CONTROL_RE.test(text.trim());
}
