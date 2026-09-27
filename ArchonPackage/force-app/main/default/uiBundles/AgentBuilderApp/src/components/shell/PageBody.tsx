import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one page container.
 *
 * Every page used to pick its own width, and the picks did not match the
 * content: Conversations capped a data table at 768px, so on a 1900px
 * screen a six-column table sat in the middle with 280px of empty margin
 * either side while its own columns were squeezed. Six different maximum
 * widths were in use across thirteen pages, none of them chosen for what
 * the page actually holds.
 *
 * Width is a property of the CONTENT, not of the page, so it is named that
 * way here. The rule is simple and has one real exception worth stating:
 * wide content should use the screen, but running text and form fields
 * should NOT — a text input stretched across 1900px is harder to use, not
 * easier, and a line of prose that long is hard to read back. So `read`
 * stays narrow on purpose; it is not an oversight to fix later.
 *
 * Padding scales with the viewport rather than sitting at one value: the
 * 20px that looks right on a laptop wastes a phone's screen and looks mean
 * on a large monitor.
 */
const WIDTHS = {
  /** Tables, dashboards, log lists. Fills the screen; capped only so a 4K
   *  monitor does not produce a single unreadable 3000px row. On any
   *  ordinary display the cap never binds and the content meets the
   *  padding. */
  wide: 'max-w-[1920px]',
  /** Cards, lists and mixed layouts — the same fill as `wide`.
   *
   *  This was 1180px, on the theory that card pages look sparse when
   *  stretched. On a 1920px screen with the nav open it left ~200px of
   *  empty space either side of every Connectors, Knowledge and AI Models
   *  panel, which read as wasted padding rather than as restraint. The
   *  name is kept so a page can be tuned on its own later without
   *  touching the others. */
  standard: 'max-w-[1920px]',
  /** Forms and prose. Deliberately narrow — see the note above. */
  read: 'max-w-3xl',
} as const;

export type PageWidth = keyof typeof WIDTHS;

export function PageBody({
  children,
  width = 'standard',
  className,
}: {
  children: ReactNode;
  width?: PageWidth;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full px-3 py-3 sm:px-4 sm:py-3.5 lg:px-5 lg:py-4', WIDTHS[width], className)}>
      {children}
    </div>
  );
}
