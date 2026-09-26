import { useEffect, useRef } from 'react';
import type { HostedBuild } from '@/components/chat/ChatPanel';
import { getArchitectBuildDetail } from '@/lib/architect-data';
import { stageReport } from '@/lib/build-report';

/**
 * Tells the Architect's build in the conversation, stage by stage, in
 * order. Each time a stage finishes the build's detail is read once and
 * that stage's report is written into the transcript — once per build
 * conversation, so a resumed build (a new job id) never repeats a stage.
 */
const ORDER = ['understand', 'survey', 'match', 'design', 'prompts', 'review', 'gaps', 'compile'];

export function useBuildReports(hosted: HostedBuild | null): void {
  const said = useRef<Set<string>>(new Set());
  const inFlight = useRef(false);
  const view = hosted?.view ?? null;
  const signature = view ? `${hosted?.jobId}:${view.status}:${view.steps.map(s => s.state[0]).join('')}` : '';

  useEffect(() => {
    if (!hosted?.jobId || !view || inFlight.current) return;
    const finished = view.steps.filter(s => s.state === 'done' || s.state === 'warn').map(s => s.key);
    const due = ORDER.filter(k => finished.includes(k) && !said.current.has(`${hosted.messageId}:${k}`));
    const waiting = view.status === 'paused' && /as asked/.test(view.error ?? '') && !said.current.has(`${hosted.messageId}:waiting:${hosted.jobId}`);
    if (!due.length && !waiting) return;
    inFlight.current = true;
    getArchitectBuildDetail(hosted.jobId)
      .then(d => {
        for (const k of due) {
          const text = stageReport(k, d, view);
          if (!text) continue;
          said.current.add(`${hosted.messageId}:${k}`);
          hosted.note(`report_${hosted.messageId}_${k}`, text);
        }
        if (waiting) {
          said.current.add(`${hosted.messageId}:waiting:${hosted.jobId}`);
          hosted.note(`report_${hosted.messageId}_waiting_${hosted.jobId}`, '**Waiting for you** — answer the questions above in your own words (or say **you decide**), and I continue the same build from here.');
        }
      })
      .catch(() => { /* the card still shows the stage; the next change retries */ })
      .finally(() => { inFlight.current = false; });
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
}
