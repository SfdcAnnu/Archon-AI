import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Check, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { Canvas } from '@/components/agent-builder/Canvas';
import { getArchitectBuildDetail, ASSIGNEE_LABEL, type BuildDetail, type BuildJobView, type BuildStep } from '@/lib/architect-data';
import { updateAgentStatus } from '@/lib/agents-data';
import type { AgentNode, AgentConnection, NodeConfig } from '@/types/agent';
import '@/styles/build-workspace.css';

/**
 * The build workspace: one card in the chat that grows stage by stage as
 * the Architect works. The stage rail on the left is the build's own step
 * list; the panel on the right is what the selected stage produced —
 * questions to answer, gaps to decide, the design as a read-only graph,
 * the reviewer's verdict, the setup list, and at the end the saved agent
 * with its Activate switch.
 *
 * Every control sends a real message into the conversation (onSend), so
 * the agent driving the build stays in step and the transcript stays
 * honest. Only activation talks to the platform directly — it is a status
 * change on a saved agent, not a build step.
 */
export interface BuildWorkspaceProps {
  requirement: string;
  jobId?: string | null;
  view: BuildJobView | null;
  interrupted?: boolean;
  isError?: boolean;
  onSend: (text: string) => void;
  /** Move this build to the other surface — the drawer offers the page,
   *  the page offers the dock. Same conversation either way, so it is a
   *  change of room, not a restart. Omitted where there is nowhere to go. */
  onMove?: () => void;
  moveLabel?: string;
}

const STAGE_SHORT: Record<string, string> = { understand: 'Understand', survey: 'Survey', match: 'Match', design: 'Design', prompts: 'Instructions', review: 'Review', gaps: 'Setup', compile: 'Save' };

export function BuildWorkspace({ requirement, jobId, view, interrupted, isError, onSend, onMove, moveLabel }: BuildWorkspaceProps) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<BuildDetail | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [decided, setDecided] = useState<Record<number, string>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [activated, setActivated] = useState<'no' | 'busy' | 'yes' | 'failed'>('no');
  const [activateError, setActivateError] = useState<string | null>(null);

  const steps: BuildStep[] = view?.steps ?? [];
  const doneCount = steps.filter(s => s.state === 'done' || s.state === 'warn').length;
  const running = view?.status === 'running' || view?.status === 'queued';
  const stageStop = view?.status === 'paused' && /as asked/.test(view.error ?? '');
  const costStop = view?.status === 'paused' && !stageStop;
  const lastDone = [...steps].reverse().find(s => s.state === 'done' || s.state === 'warn' || s.state === 'failed')?.key ?? null;
  const runningKey = steps.find(s => s.state === 'running')?.key ?? null;
  const current = picked ?? runningKey ?? lastDone ?? steps[0]?.key ?? 'understand';

  // The stage detail is read whenever the build moves: a stage finishing,
  // the job pausing or ending. Never while nothing has changed.
  useEffect(() => {
    if (!jobId || !view) return;
    let cancelled = false;
    getArchitectBuildDetail(jobId).then(d => { if (!cancelled) setDetail(d); }).catch(() => { /* the rail still shows progress */ });
    return () => { cancelled = true; };
  }, [jobId, view?.status, doneCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // A stage that FAILED is where the work resumes, not the stage after
  // it. It is not pending — it ran, it cost money, and it is the thing
  // that has to happen again — so it is looked for first. Take the first
  // pending row instead and Continue quietly steps over the fault.
  const nextStep = steps.find(s => s.state === 'failed') ?? steps.find(s => s.state === 'pending');
  const waiting = !running && !!detail && needsPerson(current, detail, decided);
  const canContinue = !!view && !running && (stageStop || view.status === 'failed') && !!nextStep;

  const prereqs = detail?.prerequisites ?? [];
  const blockingOpen = prereqs.filter(p => p.blocking && p.status !== 'done' && p.status !== 'waived' && !ticked[p.id]);
  const result = view?.status === 'done' ? view.result : undefined;

  const activate = async () => {
    if (!result) return;
    setActivated('busy'); setActivateError(null);
    try { await updateAgentStatus(result.agentId, 'Active'); setActivated('yes'); }
    catch (err) { setActivated('failed'); setActivateError(err instanceof Error ? err.message : 'Could not activate.'); }
  };

  return (
    <div className="bw" data-status={view?.status ?? 'starting'}>
      <div className="bw-hd">
        <span className="bw-ico"><Sparkles /></span>
        <span className="bw-ttl">Architect build</span>
        <span className="bw-req" title={requirement}>{requirement}</span>
        {view && <span className="bw-meta">${view.costUsd.toFixed(2)} of ${view.maxCostUsd.toFixed(2)} · {(view.elapsedMs / 1000).toFixed(0)}s</span>}
        {onMove && (
          <button type="button" className="bw-move" onClick={onMove} title={moveLabel}>
            <ExternalLink /> {moveLabel}
          </button>
        )}
      </div>

      {interrupted ? (
        <div className="bw-note warn">You left while this was building — its progress is on the New agent page.</div>
      ) : isError ? null : !view ? (
        <div className="bw-note"><Loader2 className="spin" /> Starting…</div>
      ) : (
        <div className="bw-body">
          {/* ── stage rail ─────────────────────────────────────────── */}
          <div className="bw-stages">
            {steps.map((s, i) => {
              const cls = s.state === 'done' ? 'done' : s.state === 'warn' ? 'warn' : s.state === 'failed' ? 'failed' : s.state === 'running' ? 'run' : 'off';
              const wait = !running && s.key === lastDone && detail && needsPerson(s.key, detail, decided);
              return (
                <button key={s.key} type="button" className={`bw-stage ${cls}${current === s.key ? ' sel' : ''}${wait ? ' wait' : ''}`} onClick={() => setPicked(s.key)} disabled={s.state === 'pending'}>
                  <span className="m">{s.state === 'running' ? <Loader2 className="spin" /> : s.state === 'done' ? '✓' : s.state === 'warn' || s.state === 'failed' ? '!' : wait ? '?' : i + 1}</span>
                  <span className="l">{s.label}{s.reused && <small> · kept</small>}</span>
                  <span className="d">{s.ms != null ? `${(s.ms / 1000).toFixed(1)}s` : ''}</span>
                </button>
              );
            })}
            <div className="bw-ctl">
              {running && <div className="bw-hint"><Loader2 className="spin" /> {steps.find(s => s.state === 'running')?.label ?? 'Working'}…</div>}
              {canContinue && (
                <>
                  <button type="button" className="bw-btn p" disabled={waiting} onClick={() => onSend(`Build ${jobId}: continue to the next stage.`)}>Next stage → {nextStep ? STAGE_SHORT[nextStep.key] ?? nextStep.label : ''}</button>
                  <button type="button" className="bw-btn" disabled={waiting} onClick={() => onSend(`Build ${jobId}: run all the remaining stages without stopping between them. Only stop if you need something from me.`)}>Run to the end</button>
                  <div className="bw-hint">{waiting ? 'Waiting for you — answer in the panel.' : 'Pauses only when something needs you.'}</div>
                </>
              )}
              {costStop && (
                <>
                  <button type="button" className="bw-btn p" onClick={() => onSend(`Build ${jobId}: resume from where it paused.`)}>Resume the build</button>
                  <div className="bw-hint">Paused at its cost ceiling — everything finished is saved.</div>
                </>
              )}
              {view.status === 'failed' && !canContinue && <div className="bw-hint err">{view.error ?? 'The build failed.'}</div>}
              {view.status === 'done' && <div className="bw-hint ok">{activated === 'yes' ? 'Live.' : 'Saved as a Draft. Activate from the panel.'}</div>}
            </div>
          </div>

          {/* ── the selected stage's panel ────────────────────────── */}
          <div className="bw-panel">
            {!detail && <div className="bw-note"><Loader2 className="spin" /> Reading the build…</div>}
            {detail && current === 'understand' && <Understand d={detail} answers={answers} setAnswers={setAnswers} onSend={onSend} running={running} jobId={jobId ?? ''} />}
            {detail && current === 'survey' && <Survey d={detail} />}
            {detail && current === 'match' && <Match d={detail} decided={decided} setDecided={setDecided} onSend={onSend} running={running} jobId={jobId ?? ''} />}
            {detail && current === 'design' && <Design d={detail} />}
            {detail && current === 'prompts' && <Prompts d={detail} />}
            {detail && current === 'review' && <Review d={detail} onSend={onSend} running={running} decided={decided} setDecided={setDecided} jobId={jobId ?? ''} />}
            {detail && current === 'gaps' && <Setup prereqs={prereqs} ticked={ticked} setTicked={setTicked} onSend={onSend} />}
            {detail && current === 'compile' && (
              <Saved view={view} result={result} blockingOpen={blockingOpen.length} activated={activated} activateError={activateError} onActivate={activate} onOpen={() => result && navigate(`/agent/${encodeURIComponent(result.apiName)}`)} onSetup={() => setPicked('gaps')} />
            )}
            {detail && running && current === runningKey && <div className="bw-note"><Loader2 className="spin" /> {steps.find(s => s.key === current)?.label}…</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Whether the stage shown is holding for a decision the person has not made. */
function needsPerson(key: string, d: BuildDetail, decided: Record<number, string>): boolean {
  if (key === 'understand') return false; // questions are answered by chatting; the build can also go on with assumptions
  if (key === 'match') return (d.match?.gaps ?? []).some((_, i) => !decided[i]);
  if (key === 'review') return !!d.review && d.review.verdict !== 'pass' && !decided[-1];
  return false;
}

// ── stage panels ──────────────────────────────────────────────────────
function Head({ n, title, pill, tone }: { n: number; title: string; pill?: string; tone?: 'g' | 'a' | 'c' | 'v' | 'r' }) {
  return <div className="bw-sb-hd"><span className="k">stage {n} of 8</span><h3>{title}</h3>{pill && <span className={`bw-pill ${tone ?? 'c'}`}>{pill}</span>}</div>;
}

function Understand({ d, answers, setAnswers, onSend, running, jobId }: { d: BuildDetail; answers: Record<number, string>; setAnswers: (a: Record<number, string>) => void; onSend: (t: string) => void; running: boolean; jobId: string }) {
  const r = d.requirement;
  if (!r) return <Head n={1} title="Understood what you want" pill="pending" />;
  const qs = r.openQuestions ?? [];
  const filled = qs.filter((_, i) => (answers[i] ?? '').trim());
  return (
    <>
      <Head n={1} title="Understood what you want" pill={qs.length ? `${qs.length} question${qs.length === 1 ? '' : 's'}` : `${r.capabilities.length} capabilities`} tone={qs.length ? 'a' : 'g'} />
      {r.goal && <p className="bw-p">{r.goal}</p>}
      <div className="bw-chips">{r.capabilities.map((c, i) => <span key={i} className="bw-chip">{c}</span>)}{r.riskLevel && <span className={`bw-chip ${r.riskLevel === 'high' ? 'r' : r.riskLevel === 'medium' ? 'a' : 'g'}`}>risk {r.riskLevel}</span>}</div>
      {qs.length > 0 && (
        <>
          <p className="bw-p m">Things the Architect could not tell from the requirement. Answer here, or tell it to decide.</p>
          {qs.map((q, i) => (
            <div key={i} className="bw-q">
              <div className="qt">{i + 1} · {q}</div>
              <input value={answers[i] ?? ''} placeholder="Your answer" onChange={e => setAnswers({ ...answers, [i]: e.target.value })} />
              <div className="opts"><button type="button" className={`bw-btn s${answers[i] === 'You decide' ? ' on' : ''}`} onClick={() => setAnswers({ ...answers, [i]: 'You decide' })}>You decide</button></div>
            </div>
          ))}
          <div className="bw-foot">
            <button type="button" className="bw-btn p" disabled={running || filled.length === 0} onClick={() => onSend(`Build ${jobId} — answers to your questions:\n${qs.map((q, i) => `${i + 1}. ${q}\n   → ${(answers[i] ?? '').trim() || 'You decide'}`).join('\n')}\nFold these into the requirement and continue.`)}>Answer and continue</button>
            <span className="hint">or type the answers in the chat</span>
          </div>
        </>
      )}
      {r.successCriteria?.length > 0 && <div><div className="bw-label">Success looks like</div><ul className="bw-ul">{r.successCriteria.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
    </>
  );
}

function Survey({ d }: { d: BuildDetail }) {
  const s = d.survey;
  if (!s) return <Head n={2} title="Looked through your Salesforce org" pill="pending" />;
  const entries = Object.entries(s);
  return (
    <>
      <Head n={2} title="Looked through your Salesforce org" pill="read-only" tone="g" />
      <p className="bw-p m">What the Architect read before designing. Nothing was changed.</p>
      {entries.map(([k, v]) => (
        <div key={k}>
          <div className="bw-label">{k.replace(/([a-z])([A-Z])/g, '$1 $2')}{typeof v === 'object' && v && 'count' in v ? ` · ${(v as { count: number }).count}` : ''}</div>
          {typeof v === 'object' && v && 'sample' in v ? <div className="bw-chips">{(v as { sample: string[] }).sample.map((x, i) => <span key={i} className="bw-chip g">{x}</span>)}</div>
            : typeof v === 'object' && v && 'keys' in v ? <div className="bw-chips">{(v as { keys: string[] }).keys.map((x, i) => <span key={i} className="bw-chip">{x}</span>)}</div>
            : <p className="bw-p">{String(v)}</p>}
        </div>
      ))}
    </>
  );
}

function Match({ d, decided, setDecided, onSend, running, jobId }: { d: BuildDetail; decided: Record<number, string>; setDecided: (x: Record<number, string>) => void; onSend: (t: string) => void; running: boolean; jobId: string }) {
  const m = d.match;
  if (!m) return <Head n={3} title="Matched what you need to what you have" pill="pending" />;
  const gaps = m.gaps ?? [];
  const open = gaps.filter((_, i) => !decided[i]).length;
  return (
    <>
      <Head n={3} title="Matched what you need to what you have" pill={gaps.length ? `${gaps.length} gap${gaps.length === 1 ? '' : 's'}` : 'all covered'} tone={gaps.length ? 'a' : 'g'} />
      {m.matched.length > 0 && <div><div className="bw-label">Covered by what exists</div><div className="bw-chips">{m.matched.map((c, i) => <span key={i} className="bw-chip g">{c}</span>)}</div></div>}
      {gaps.length > 0 && <p className="bw-p m">Each gap needs a decision. The Metadata Expert can create fields, objects, rules and flows for you — every deploy waits for your approval.</p>}
      {gaps.map((g, i) => (
        <div key={i} className={`bw-gap ${g.state === 'missing' ? 'blk' : ''}${decided[i] ? ' done' : ''}`}>
          <span className="bar" />
          <div>
            <div className="t">{g.capability || `Gap ${i + 1}`} <small>{g.state === 'missing' ? 'missing' : 'partly there'}</small></div>
            {g.why && <div className="w">{g.why}</div>}
            {g.have && <div className="w">Have: {g.have}</div>}
            {g.need && <div className="w"><span>Needs: {g.need}</span></div>}
          </div>
          <div className="acts">
            {decided[i] ? <span className="st">{decided[i]}</span> : (
              <>
                <button type="button" className="bw-btn s" disabled={running} onClick={() => { setDecided({ ...decided, [i]: 'asked the Metadata Expert' }); onSend(`Create this in my org for me: ${g.need || g.capability}. ${g.why ? `Reason: ${g.why}. ` : ''}Hand it to the Metadata Expert and show me the change before it deploys.`); }}>Let Metadata Expert do it</button>
                <button type="button" className="bw-btn s" disabled={running} onClick={() => { setDecided({ ...decided, [i]: 'later · on the setup list' }); onSend(`Leave this gap for later and keep it on the setup list: ${g.capability}.`); }}>I'll do it later</button>
              </>
            )}
          </div>
        </div>
      ))}
      {gaps.length > 0 && <div className="bw-foot"><button type="button" className="bw-btn p" disabled={running || open > 0} onClick={() => onSend(`Build ${jobId}: every gap is decided, continue to the design.`)}>Continue to the design</button><span className="hint">{open ? `${open} still to decide` : 'nothing is deployed without your approval'}</span></div>}
    </>
  );
}

function Design({ d }: { d: BuildDetail }) {
  const des = d.design;
  const nodes = useMemo<AgentNode[]>(() => (des?.preview.nodes ?? []).map((n, i) => ({ id: n.id, name: n.name, nodeType: n.nodeType, nodeSubType: n.nodeSubType, config: n.config as NodeConfig, positionX: n.positionX, positionY: n.positionY, sortOrder: i, isEnabled: true })), [des]);
  const connections = useMemo<AgentConnection[]>(() => (des?.preview.connections ?? []).map(c => ({ ...c })), [des]);
  if (!des) return <Head n={4} title="Designed the agent" pill="pending" />;
  const noop = () => {};
  return (
    <>
      <Head n={4} title="Designed the agent" pill="preview · read-only" tone="v" />
      <p className="bw-p">{des.name}{des.department ? ` · ${des.department}` : ''}{des.description ? ` — ${des.description}` : ''}</p>
      <div className="bw-canvas">
        <Canvas readOnly nodes={nodes} connections={connections} selectedNodeId={null} onSelectNode={noop} onMoveNode={noop} onConnect={noop} onDropNode={noop} onDropConnector={noop} />
      </div>
      <div className="bw-chips">
        <span className="bw-chip v">{des.counts.specialists} specialist{des.counts.specialists === 1 ? '' : 's'}</span>
        <span className="bw-chip">{des.counts.tools} tool{des.counts.tools === 1 ? '' : 's'}</span>
        {des.counts.approvals > 0 && <span className="bw-chip a">{des.counts.approvals} approval gate{des.counts.approvals === 1 ? '' : 's'}</span>}
        {des.trigger && <span className="bw-chip">trigger · {des.trigger.type}{des.trigger.channel ? ` · ${des.trigger.channel}` : ''}</span>}
        {des.budgets && <span className="bw-chip">{des.budgets.maxSteps} steps · ${des.budgets.maxCostUsd} max</span>}
      </div>
      <p className="bw-p m">This is the graph the builder will show. Nothing is saved yet — say what to change, or continue.</p>
    </>
  );
}

function Prompts({ d }: { d: BuildDetail }) {
  const list = d.design?.instructions ?? [];
  const [open, setOpen] = useState<string | null>(list[0]?.id ?? null);
  if (!list.length) return <Head n={5} title="Wrote its instructions" pill="pending" />;
  return (
    <>
      <Head n={5} title="Wrote its instructions" pill={`${list.length} node${list.length === 1 ? '' : 's'}`} tone="g" />
      <p className="bw-p m">One instruction set per node, written from your requirement and answers.</p>
      {list.map(n => (
        <div key={n.id} className="bw-instr">
          <button type="button" className="bw-instr-hd" onClick={() => setOpen(o => (o === n.id ? null : n.id))}><b>{n.label}</b><small>{n.role === 'agent' ? 'router' : 'specialist'}</small><span>{open === n.id ? '−' : '+'}</span></button>
          {open === n.id && <pre>{n.text || '(no instructions yet)'}</pre>}
        </div>
      ))}
    </>
  );
}

function Review({ d, onSend, running, decided, setDecided, jobId }: { d: BuildDetail; onSend: (t: string) => void; running: boolean; decided: Record<number, string>; setDecided: (x: Record<number, string>) => void; jobId: string }) {
  const r = d.review;
  if (!r) return <Head n={6} title="Checked it against what you asked for" pill="pending" />;
  const pass = r.verdict === 'pass';
  const uncovered = r.uncovered ?? [];
  const failures = r.failures ?? [];
  const settled = !!decided[-1];
  return (
    <>
      <Head n={6} title="Checked it against what you asked for" pill={r.verdict.replace(/_/g, ' ')} tone={pass ? 'g' : r.verdict === 'pass_with_risk' ? 'a' : 'r'} />
      <div className={`bw-verdict ${pass ? 'pass' : r.verdict === 'pass_with_risk' ? 'risk' : 'fail'}`}>
        <span className="v">{r.verdict.replace(/_/g, ' ').toUpperCase()}</span>
        <div>
          <p className="bw-p">{pass ? 'Every capability you asked for is covered by the design.' : uncovered.length ? 'Asked for, but nothing in the design covers it:' : 'The reviewer raised concerns:'}{r.repaired ? ' A repair round already ran; this is the re-check.' : ''}</p>
          {uncovered.length > 0 && <ul className="bw-ul">{uncovered.map((u, i) => <li key={i}>{u}</li>)}</ul>}
          {failures.length > 0 && <ul className="bw-ul">{failures.slice(0, 6).map((f, i) => <li key={i}>{String(f.message ?? f.issue ?? f.detail ?? JSON.stringify(f)).slice(0, 240)}</li>)}</ul>}
        </div>
      </div>
      {!pass && !settled && (
        <div className="bw-foot">
          <button type="button" className="bw-btn p" disabled={running} onClick={() => { setDecided({ ...decided, [-1]: 'fix' }); onSend(`Build ${jobId}: fix what the review found${uncovered.length ? `: ${uncovered.join('; ')}` : ''}. Repair the design and instructions for the missing pieces only, then re-check.`); }}>Fix these</button>
          <button type="button" className="bw-btn" disabled={running} onClick={() => { setDecided({ ...decided, [-1]: 'accept' }); onSend(`Build ${jobId}: accept the review risk as it is and continue.`); }}>Accept the risk</button>
          <span className="hint">a fix re-runs design and instructions for the missing piece only</span>
        </div>
      )}
    </>
  );
}

function Setup({ prereqs, ticked, setTicked, onSend }: { prereqs: BuildDetail['prerequisites']; ticked: Record<string, boolean>; setTicked: (t: Record<string, boolean>) => void; onSend: (t: string) => void }) {
  const open = prereqs.filter(p => p.status !== 'done' && p.status !== 'waived' && !ticked[p.id]).length;
  return (
    <>
      <Head n={7} title="Listed the outstanding setup" pill={prereqs.length ? `${open} open` : 'nothing needed'} tone={open ? 'a' : 'g'} />
      {prereqs.length === 0 ? <p className="bw-p m">Nothing in your org stands in the way of this agent.</p> : <p className="bw-p m">What has to be true in the org before this agent goes live. Tick what is done; blocking items gate activation.</p>}
      <div className="bw-check">
        {prereqs.map(p => {
          const done = p.status === 'done' || p.status === 'waived' || !!ticked[p.id];
          return (
            <label key={p.id} className={done ? 'done' : ''}>
              <input type="checkbox" checked={done} disabled={p.status === 'done' || p.status === 'waived'} onChange={e => { setTicked({ ...ticked, [p.id]: e.target.checked }); onSend(`${e.target.checked ? 'Done' : 'Not done yet'}: ${p.title}.`); }} />
              <span><span className="t">{p.title}</span><br /><span className="who">{ASSIGNEE_LABEL[p.assignee] ?? p.assignee}{p.estimatedEffort ? ` · ${p.estimatedEffort}` : ''}{p.status === 'waived' ? ' · waived' : ''}</span>{p.why && <span className="why">{p.why}</span>}</span>
              <span className="blk">{p.blocking ? 'BLOCKING' : ''}</span>
            </label>
          );
        })}
      </div>
    </>
  );
}

function Saved({ view, result, blockingOpen, activated, activateError, onActivate, onOpen, onSetup }: { view: BuildJobView; result?: BuildJobView['result']; blockingOpen: number; activated: 'no' | 'busy' | 'yes' | 'failed'; activateError: string | null; onActivate: () => void; onOpen: () => void; onSetup: () => void }) {
  if (view.status !== 'done' || !result) return <Head n={8} title="Saved the agent" pill={view.status === 'failed' ? 'failed' : 'pending'} tone={view.status === 'failed' ? 'r' : 'c'} />;
  const live = activated === 'yes' || result.status === 'Active';
  return (
    <>
      <Head n={8} title="Saved the agent" pill={live ? 'active' : 'draft'} tone={live ? 'g' : 'a'} />
      <div className="bw-final">
        <div><div className="big">{result.apiName}</div><div className="bw-p m">{result.shape} · about ${result.estimate.costPerRunUsd.toFixed(3)} per run · ~{result.estimate.latencySeconds}s</div></div>
        <span className={`st${live ? ' live' : ''}`}>{live ? 'Active' : 'Draft'}</span>
        <div className="r">
          <button type="button" className="bw-btn" onClick={onOpen}><ExternalLink /> Open in the builder</button>
          {!live && <button type="button" className="bw-btn g" disabled={blockingOpen > 0 || activated === 'busy'} onClick={onActivate}>{activated === 'busy' ? <Loader2 className="spin" /> : <Check />} Activate</button>}
        </div>
      </div>
      {result.summarySteps?.length > 0 && <p className="bw-p m">{result.summarySteps.join(' → ')}</p>}
      {activateError && <div className="bw-note warn"><AlertTriangle /> {activateError}</div>}
      <p className="bw-p m">{live ? 'The agent is live. Test it from Chat, watch it under Runs, and every write it makes waits for approval.' : blockingOpen ? `Activate turns on once the ${blockingOpen} blocking setup item${blockingOpen === 1 ? '' : 's'} ${blockingOpen === 1 ? 'is' : 'are'} done — tick them in stage 7, or ask me to hand them to the Metadata Expert.` : 'Everything blocking is done. Activate when you are ready — it stays a Draft until then.'}</p>
      {blockingOpen > 0 && !live && <div className="bw-foot"><button type="button" className="bw-btn" onClick={onSetup}>Back to the setup list</button></div>}
    </>
  );
}
