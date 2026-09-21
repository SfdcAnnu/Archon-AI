import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolResultCards } from './ToolResultCards';
import type { ChatToolCallSummary } from '@/lib/ws-chat';

/**
 * One turn of a live intake agent drew a 1,500-line object describe, two
 * record writes and a search — all of it open, all of it between one
 * reply and the next. Reading the conversation meant scrolling past the
 * machinery.
 *
 * What these hold: the work is reachable, and it is not in the way.
 */
const call = (name: string, extra: Partial<ChatToolCallSummary> = {}): ChatToolCallSummary => ({
  id: `c_${name}`, name, input: {}, output: '{"ok":true}', ...extra,
});

describe('ToolResultCards', () => {
  it('draws nothing at all when no tool ran', () => {
    const { container } = render(<ToolResultCards calls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts closed, however much the turn did', () => {
    const { container } = render(<ToolResultCards calls={[call('getObjectSchema'), call('createSobjectRecord')]} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    // The cards are what was in the way; none of them is rendered. The
    // summary row names the tools, so this has to look for the CARD, not
    // for the tool's name.
    expect(container.querySelectorAll('.tc-card')).toHaveLength(0);
  });

  it('says how much work there was without being opened', () => {
    render(<ToolResultCards calls={[call('getObjectSchema'), call('createSobjectRecord'), call('soqlQuery')]} />);
    expect(screen.getByRole('button')).toHaveTextContent('3 tools run');
    expect(screen.getByRole('button')).toHaveTextContent('getObjectSchema');
  });

  it('counts one tool as one, not "1 tools"', () => {
    render(<ToolResultCards calls={[call('soqlQuery')]} />);
    expect(screen.getByRole('button')).toHaveTextContent('1 tool run');
  });

  it('names a failure in the summary instead of springing open', () => {
    render(<ToolResultCards calls={[call('find', { isError: true }), call('soqlQuery')]} />);
    const row = screen.getByRole('button');
    expect(row).toHaveTextContent('1 failed');
    // Telling the reader is not the same as deciding for them.
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on a click and shows the work', async () => {
    const { container } = render(<ToolResultCards calls={[call('createSobjectRecord'), call('soqlQuery')]} />);
    const row = screen.getByRole('button');
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelectorAll('.tc-card')).toHaveLength(2);
  });

  it('closes again', async () => {
    const { container } = render(<ToolResultCards calls={[call('createSobjectRecord')]} />);
    const row = screen.getByRole('button');
    await userEvent.click(row);
    expect(container.querySelectorAll('.tc-card')).toHaveLength(1);
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelectorAll('.tc-card')).toHaveLength(0);
  });

  it('keeps each message’s row independent', async () => {
    // Opening one turn's tools is not a request to see every turn's.
    const { unmount } = render(<ToolResultCards calls={[call('soqlQuery')]} />);
    await userEvent.click(screen.getByRole('button'));
    unmount();
    render(<ToolResultCards calls={[call('soqlQuery')]} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('counts a specialist’s own calls, which is where the volume hides', () => {
    const handoff = call('ask_metadata_expert_ab12cd', {
      nested: [call('getObjectSchema'), call('soqlQuery')],
    });
    render(<ToolResultCards calls={[handoff]} />);
    expect(screen.getByRole('button')).toHaveTextContent('3 tools run');
  });

  it('drops the ask_ prefix and node id from the summary', () => {
    render(<ToolResultCards calls={[call('ask_metadata_expert_ab12cd')]} />);
    expect(screen.getByRole('button')).toHaveTextContent('metadata expert');
    expect(screen.getByRole('button')).not.toHaveTextContent('ask_');
  });
});
