import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * The app's tabs, orbiting the core. On the entrance they arrive from deep
 * in the z-axis, blurred, and sharpen as they settle; afterwards they are
 * an ordinary launcher. Positions are computed from the field's size so
 * the ring fits whatever width the page has; below 760px the orbit becomes
 * a plain grid and only the fade remains.
 *
 *   far   parked at depth, invisible (before the entrance)
 *   fly   travelling to their places
 *   set   settled, labels visible
 */
export interface OrbitTab {
  key: string;
  label: string;
  group: 'build' | 'monitor' | 'manage';
  href: string;
  icon: ReactNode;
  badge?: number;
}

export function OrbitTabs({ tabs, state, dim, onPick }: { tabs: OrbitTab[]; state: 'far' | 'fly' | 'set'; dim?: boolean; onPick: (href: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  const layout = () => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const rx = Math.min(w / 2 - 70, 360);
    const ry = Math.min(h / 2 - 52, 250);
    const n = tabs.length;
    el.querySelectorAll<HTMLElement>('.home-tab').forEach((t, i) => {
      const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
      t.style.setProperty('--x', `${w / 2 + rx * Math.cos(a)}px`);
      t.style.setProperty('--y', `${h / 2 + ry * Math.sin(a)}px`);
    });
  };
  useLayoutEffect(layout);
  useEffect(() => {
    addEventListener('resize', layout);
    return () => removeEventListener('resize', layout);
  });

  // A few degrees of tilt toward the pointer, for depth. Pure decoration,
  // so it is skipped on touch and under reduced motion.
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const parent = el.parentElement;
    if (!parent) return;
    const move = (e: MouseEvent) => {
      if (innerWidth < 760) return;
      const r = parent.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - 0.5;
      const dy = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `rotateY(${(dx * 6).toFixed(2)}deg) rotateX(${(-dy * 6).toFixed(2)}deg)`;
    };
    const leave = () => { el.style.transform = ''; };
    parent.addEventListener('mousemove', move);
    parent.addEventListener('mouseleave', leave);
    return () => { parent.removeEventListener('mousemove', move); parent.removeEventListener('mouseleave', leave); };
  }, []);

  return (
    <div ref={ref} className={`home-orbit ${state}${dim ? ' dim' : ''}`}>
      {tabs.map((t, i) => (
        <button
          key={t.key}
          type="button"
          className={`home-tab ${t.group}`}
          style={{ transitionDelay: state === 'fly' ? `${i * 55}ms` : '0ms' }}
          onClick={() => onPick(t.href)}
          aria-label={t.label}
        >
          <span className="ic">{t.icon}</span>
          <span className="l">{t.label}</span>
          <span className="g">{t.group}</span>
          {t.badge ? <span className="badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
