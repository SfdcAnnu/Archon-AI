import { memo } from 'react';
import { renderMarkdown } from '@/lib/render-markdown';

/**
 * One assistant message's text.
 *
 * WHY THIS IS ITS OWN MEMOISED COMPONENT. Markdown used to be parsed
 * inline in the transcript's map body, so every assistant message in the
 * conversation was re-parsed and its DOM replaced on every render of the
 * panel. That was merely wasteful while replies arrived whole. Once text
 * streams it becomes a correctness problem: a reader who selects a
 * sentence loses the selection the next time anything re-renders, which
 * during a stream is many times a second.
 *
 * Memoising on `text` means a settled message is parsed once and then left
 * alone no matter what else changes around it, so a selection inside it
 * survives.
 *
 * WHILE STREAMING, the text is NOT parsed at all. Half-written markdown
 * renders as garbage — an unclosed fence swallows the rest of the reply,
 * a lone asterisk turns into a bullet — and re-parsing it per chunk is
 * exactly the DOM churn that eats selections. Plain preformatted text
 * reads correctly at every intermediate state, and the finished text is
 * parsed once when the turn lands.
 */
export const MessageBody = memo(function MessageBody({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  if (streaming) {
    return (
      <div className="prose-chat whitespace-pre-wrap break-words">
        {text}
        <span className="chat-cursor" aria-hidden="true" />
      </div>
    );
  }
  return <div className="prose-chat" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
});
