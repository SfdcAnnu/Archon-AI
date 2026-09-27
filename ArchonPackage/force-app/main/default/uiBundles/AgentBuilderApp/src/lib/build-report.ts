import type { BuildDetail, BuildJobView } from './architect-data';
import { ASSIGNEE_LABEL } from './architect-data';

/**
 * The Architect's build, told in the conversation — one report per stage,
 * in order, written from the build's own data so every name and number is
 * exact. The card beside the chat shows the same facts as controls; these
 * are the sentences a person reads to know what happened, what is missing,
 * how to close it and what comes next.
 */

export interface Finding { what: string; why: string | null }

const clean = (s: string) => s.replace(/^[\s"“”']+|[\s"“”']+$/g, '').replace(/\s+/g, ' ').trim();

/** A reviewer finding in whatever shape it arrived — a sentence, a JSON
 *  string, or an object — as "what is missing" and "why". */
export function readableFinding(x: unknown): Finding | null {
  let v: unknown = x;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('{')) {
      try { v = JSON.parse(t); } catch {
        // clipped JSON: pull the two fields out by hand
        const req = /"requirement"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(t)?.[1];
        const why = /"rootCause"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(t)?.[1];
        return req ? { what: clean(req), why: why ? clean(why) : null } : { what: clean(t.replace(/[{}]/g, '')), why: null };
      }
    } else return t ? { what: clean(t), why: null } : null;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const what = [o.requirement, o.capability, o.item, o.message, o.issue, o.detail].find(s => typeof s === 'string' && s.trim()) as string | undefined;
    const why = [o.rootCause, o.why, o.reason, o.fix].find(s => typeof s === 'string' && s.trim()) as string | undefined;
    if (!what) return null;
    return { what: clean(what), why: why ? clean(why) : null };
  }
  return null;
}

/** Every finding the review holds, one per requirement, merged. */
export function reviewFindings(review: BuildDetail['review']): Finding[] {
  if (!review) return [];
  const out: Finding[] = [];
  const seen = new Map<string, Finding>();
  for (const raw of [...(review.uncovered ?? []), ...(review.failures ?? [])]) {
    const f = readableFinding(raw);
    if (!f) continue;
    const key = f.what.toLowerCase().slice(0, 80);
    const had = seen.get(key);
    if (had) { if (!had.why && f.why) had.why = f.why; continue; }
    seen.set(key, f);
    out.push(f);
  }
  return out;
}

const KIND_LABEL: Record<string, string> = { communication: 'Communication agent — it talks with people and waits for their replies', automation: 'Automation agent — it runs in one go from a Flow, Apex or a schedule and returns a result', both: 'Communication and automation — the same agent does both' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The report for one stage, or null when that stage has nothing to say yet. */
export function stageReport(stage: string, d: BuildDetail, view: BuildJobView | null): string | null {
  switch (stage) {
    case 'understand': {
      const r = d.requirement;
      if (!r) return null;
      const lines = [`**1 · Understood your requirement**`, '', r.goal];
      if (r.capabilities.length) lines.push('', 'The agent needs to:', ...r.capabilities.map(c => `- ${c}`));
      if (r.agentType) lines.push('', `**Type:** ${KIND_LABEL[r.agentType] ?? r.agentType}.`);
      const qs = r.openQuestions ?? [];
      if (qs.length) {
        lines.push('', '**Assumptions I made** — say if any is wrong, otherwise I go on with them:', ...qs.map((q, i) => `${i + 1}. ${q}`));
      }
      if (r.clarifications?.length) lines.push('', '**Your answers, now part of the requirement:**', ...r.clarifications.map(c => `- ${c}`));
      return lines.join('\n');
    }
    case 'survey': {
      const s = d.survey;
      if (!s) return null;
      const parts = Object.entries(s).map(([k, v]) => {
        const name = k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        return typeof v === 'object' && v && 'count' in v ? `${(v as { count: number }).count} ${name}` : null;
      }).filter(Boolean);
      return `**2 · Checked your org** — read ${parts.join(', ') || 'the objects and tools'}. Nothing was changed.`;
    }
    case 'match': {
      const m = d.match;
      if (!m) return null;
      const lines = ['**3 · What your org already has, and what is missing**', ''];
      if (m.matched.length) lines.push(`Already covered: ${m.matched.join('; ')}.`);
      const gaps = m.gaps ?? [];
      if (!gaps.length) { lines.push('', 'No gaps — everything it needs exists.'); return lines.join('\n'); }
      lines.push('', `**${plural(gaps.length, 'gap')} to close:**`);
      gaps.forEach((g, i) => {
        lines.push('', `${i + 1}. **${g.capability || g.need || 'Missing piece'}** — ${g.state === 'missing' ? 'missing' : 'partly there'}.`);
        if (g.why) lines.push(`   Why it matters: ${g.why}`);
        if (g.have) lines.push(`   Already there: ${g.have}`);
        if (g.need) lines.push(`   Needed: ${g.need}`);
        lines.push('   How to close it: ask me to have the **Metadata Expert** create it (you approve the change before it deploys), do it yourself in Setup, or tell me to **leave it out** and I design without it.');
      });
      return lines.join('\n');
    }
    case 'design': {
      const des = d.design;
      if (!des) return null;
      const lines = [`**4 · Designed the agent** — ${des.name}${des.department ? ` (${des.department})` : ''}`];
      if (des.description) lines.push('', des.description);
      lines.push('', `It has ${plural(des.counts.specialists, 'specialist')}, ${plural(des.counts.tools, 'tool')} and ${plural(des.counts.approvals, 'approval gate')}${des.trigger ? `; it starts from a ${des.trigger.type}${des.trigger.channel ? ` on ${des.trigger.channel}` : ''} trigger` : ''}. The graph is on the right.`);
      return lines.join('\n');
    }
    case 'prompts': {
      const n = d.design?.instructions?.length ?? 0;
      return n ? `**5 · Wrote its instructions** for ${plural(n, 'node')} — the steps, the rules and what it says when something is missing. You can read them under stage 5 on the right.` : null;
    }
    case 'review': {
      const r = d.review;
      if (!r) return null;
      const findings = reviewFindings(r);
      if (r.verdict === 'pass' || !findings.length) return `**6 · Checked it against what you asked for** — everything you asked for is covered${r.repaired ? ' (after one repair round)' : ''}.`;
      const lines = [`**6 · Checked it against what you asked for** — ${plural(findings.length, 'thing')} ${findings.length === 1 ? 'is' : 'are'} not covered${r.repaired ? ', even after one repair round' : ''}:`, ''];
      findings.forEach((f, i) => lines.push(`${i + 1}. ${f.what}${f.why ? `\n   Why: ${f.why}` : ''}`));
      lines.push('', 'Say **fix these** and I repair only those pieces, or **accept the risk** to keep the agent as it is.');
      return lines.join('\n');
    }
    case 'gaps': {
      const ps = d.prerequisites ?? [];
      if (!ps.length) return '**7 · Setup** — nothing in your org stands in the way of this agent.';
      const blocking = ps.filter(p => p.blocking);
      const lines = [`**7 · Setup needed before it can go live** — ${plural(ps.length, 'item')}${blocking.length ? `, ${blocking.length} blocking` : ''}:`, ''];
      ps.forEach((p, i) => {
        lines.push(`${i + 1}. **${p.title}**${p.blocking ? ' — blocking' : ''} · ${ASSIGNEE_LABEL[p.assignee] ?? p.assignee}${p.estimatedEffort ? ` · ${p.estimatedEffort}` : ''}`);
        if (p.why) lines.push(`   ${p.why}`);
      });
      return lines.join('\n');
    }
    case 'compile': {
      if (view?.status !== 'done' || !view.result) return null;
      const res = view.result;
      const blocking = (d.prerequisites ?? []).filter(p => p.blocking && p.status !== 'done' && p.status !== 'waived');
      const findings = reviewFindings(d.review);
      const lines = [`**8 · Saved** — **${res.apiName}** is a ${res.status}. About $${res.estimate.costPerRunUsd.toFixed(3)} per run, roughly ${res.estimate.latencySeconds}s.`, '', '**Where it stands**'];
      lines.push('- Done: requirement, org check, design, instructions, review, saved.');
      if (findings.length) lines.push(`- Review: ${plural(findings.length, 'item')} still not covered — fix or accept.`);
      if (blocking.length) lines.push(`- Needs you: ${blocking.map(b => b.title).join('; ')}.`);
      lines.push('', `**Next step:** ${blocking.length ? `close the blocking setup (${blocking[0].title}) — ask me to hand it to the Metadata Expert — then activate.` : findings.length ? 'decide on the review items, then activate from the build panel.' : 'activate it from the build panel, then test it.'}`);
      return lines.join('\n');
    }
    default:
      return null;
  }
}
