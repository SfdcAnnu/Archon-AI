/** Default (no node selected) state — deliberately just the hint, not the
 *  agent name/description/stat grid (that moved to the "Agent info" popover
 *  in AgentBuilder.tsx's header, opt-in via its icon instead of always-on
 *  here — see the ⓘ button next to the agent name). */
export function EmptyPanel() {
  return (
    <p className="text-[11.5px] leading-relaxed text-muted-foreground">
      Click any node to inspect or edit it. The <span className="font-semibold text-foreground">Tools</span> anchor
      at the bottom of an AI or Subagent node is where Catalog, Subagent, and Tool nodes attach — drag one from
      the left palette onto the canvas and connect it there.
    </p>
  );
}
