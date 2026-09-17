import { useEffect, useRef } from 'react';
import { useThemeToken } from '@/lib/theme';

/**
 * The centre of Home: the copilot's core. Three spinning arcs, a particle
 * field, and a disc that says what the agent is doing. The phase drives
 * colour, speed and motion — the same vocabulary the chat's ring uses:
 *
 *   off     standby, before the page has come alive
 *   ready   waiting — breathing glow
 *   listen  mic open — brighter, faster breath
 *   think   a turn in flight — amber, particles pull in
 *   speak   reading the answer aloud — green pulse
 *   build   the Architect is working — everything faster
 */
export type CorePhase = 'off' | 'ready' | 'listen' | 'think' | 'speak' | 'build';

interface Particle {
  a: number;
  r: number;
  cr: number;
  s: number;
  z: number;
  sz: number;
}

/** A token's value as r,g,b — tokens are hex in the stylesheet, the
 *  pre-mount fallbacks are rgb(); the canvas needs numbers for alpha. */
function toRgb(colour: string): [number, number, number] {
  const c = colour.trim();
  const rgb = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const h = c.replace('#', '');
  const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const SIZE = 560; // canvas box; the ring itself is 260

export function CoreRing({ phase, label, sub, burst }: { phase: CorePhase; label: string; sub: string; burst: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<CorePhase>(phase);
  const scatterRef = useRef(0);
  const particles = useRef<Particle[]>([]);
  const primary = useThemeToken('--primary', 'rgb(1, 118, 211)');
  const amber = useThemeToken('--node-amber', 'rgb(221, 122, 1)');
  const green = useThemeToken('--archon-success', 'rgb(46, 132, 74)');
  const colours = useRef({ primary, amber, green });

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    colours.current = { primary, amber, green };
  }, [primary, amber, green]);
  // A burst is a counter: every increment scatters the field once.
  useEffect(() => {
    if (burst > 0) scatterRef.current = 1;
  }, [burst]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (particles.current.length === 0) {
      for (let i = 0; i < 72; i++) {
        const r = 70 + Math.random() * 180;
        particles.current.push({ a: Math.random() * Math.PI * 2, r, cr: r, s: (0.0018 + Math.random() * 0.0035) * (Math.random() < 0.5 ? 1 : -1), z: Math.random(), sz: 0.8 + Math.random() * 1.6 });
      }
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const draw = () => {
      const p = phaseRef.current;
      const { primary: c1, amber: c2, green: c3 } = colours.current;
      const rgb = toRgb(p === 'think' || p === 'build' ? c2 : p === 'speak' ? c3 : c1);
      ctx.clearRect(0, 0, SIZE, SIZE);
      const cx = SIZE / 2;
      const cy = SIZE / 2;
      const scatter = scatterRef.current;
      for (const q of particles.current) {
        let speed = q.s;
        let target = q.r;
        if (p === 'think') { speed = q.s * 2.6; target = Math.max(62, q.r * 0.6); }
        if (p === 'speak') speed = q.s * 1.4;
        if (p === 'build') { speed = q.s * 3.2; target = q.r * 0.75; }
        if (p === 'listen') speed = q.s * 1.2;
        if (!reduced) q.a += speed;
        q.cr += (target - q.cr) * 0.04;
        const rr = q.cr + (scatter > 0 ? scatter * q.z * 160 : 0);
        const x = cx + Math.cos(q.a) * rr;
        const y = cy + Math.sin(q.a) * rr * 0.92;
        const base = p === 'off' ? 0.08 : 0.18 + 0.55 * (1 - Math.min(1, (rr - 60) / 230));
        const alpha = base * (scatter > 0 ? 1 - scatter * 0.6 : 1);
        ctx.beginPath();
        ctx.arc(x, y, q.sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
        ctx.fill();
      }
      if (scatter > 0) scatterRef.current = Math.max(0, scatter - 0.02);
      if (!reduced || scatterRef.current > 0) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="home-core" data-phase={phase} aria-live="polite">
      <canvas ref={canvasRef} width={SIZE} height={SIZE} className="home-core-canvas" aria-hidden="true" />
      <svg className="home-core-rings" viewBox="0 0 200 200" aria-hidden="true">
        <circle className="tick" cx="100" cy="100" r="88" />
        <circle className="arc a1" cx="100" cy="100" r="96" />
        <circle className="arc a2" cx="100" cy="100" r="80" />
        <circle className="arc a3" cx="100" cy="100" r="66" />
        <g className="sat"><circle cx="100" cy="4" r="2.4" /></g>
        <g className="sat sat2"><circle cx="100" cy="20" r="1.8" /></g>
      </svg>
      <div className="home-core-disc">
        <div>
          <b>{label}</b>
          <span>{sub}</span>
        </div>
      </div>
    </div>
  );
}
