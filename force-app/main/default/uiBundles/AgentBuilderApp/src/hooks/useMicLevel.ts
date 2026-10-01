import { useEffect, type RefObject } from 'react';

/**
 * How loud the microphone is right now, 0..1, written straight onto an
 * element as the CSS variable --lvl for as long as `active` holds.
 *
 * No React state is touched per frame: the rings around the orb read the
 * variable in CSS, so sixty updates a second re-render nothing. The
 * stream is opened when listening starts and released the moment it
 * stops, so the browser's recording indicator tells the truth. Speech
 * recognition holds its own stream; Chrome reuses the permission, so
 * there is no second prompt. Without a microphone (or when the person
 * declines) the rings still ripple, just at a fixed size.
 */
export function useMicLevel(active: boolean, target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const el = target.current;
    if (!el || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return;
    let cancelled = false;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        ctx = new AudioContext();
        // A context made outside a click starts suspended; the tap on the
        // mic (or on Talk) is the activation that lets this succeed.
        await ctx.resume().catch(() => undefined);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let shown = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          // Speech at a normal distance peaks near .25 RMS; that is "loud".
          const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
          // Quick to rise, slow to fall, so a word lands and then fades.
          shown += (level - shown) * (level > shown ? 0.5 : 0.15);
          el.style.setProperty('--lvl', shown.toFixed(3));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        /* no meter: the rings keep their fixed size */
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      void ctx?.close().catch(() => undefined);
      el.style.removeProperty('--lvl');
    };
  }, [active, target]);
}
