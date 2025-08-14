'use client';

import React, {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
  useDeferredValue,
  useRef,
} from 'react';

import { ChatMessageItem } from '@/components/chat-message';
import { useChatScroll } from '@/hooks/use-chat-scroll';
import { type ChatMessage, useRealtimeChat } from '@/hooks/use-realtime-chat';
import { Button } from '@/components/ui/button';
import { Send, Square } from 'lucide-react';

interface RealtimeChatProps {
  roomName: string;
  username: string;
  onMessage?: (messages: ChatMessage[]) => void;
  messages?: ChatMessage[];
}

/** Memoized row to avoid rerenders while typing */
const ChatRow = memo(function ChatRow({
  message,
  username,
  showHeader,
}: {
  message: ChatMessage;
  username: string;
  showHeader: boolean;
}) {
  return (
    <div className='animate-in fade-in slide-in-from-bottom-4 duration-300'>
      <ChatMessageItem
        message={message}
        isOwnMessage={message.user.name === username}
        showHeader={showHeader}
      />
    </div>
  );
});

/** List uses forwardRef so parent can pass its ref without type errors */
const MessagesList = memo(
  forwardRef<HTMLDivElement, { messages: ChatMessage[]; username: string }>(
    function MessagesList({ messages, username }, ref) {
      return (
        <div
          ref={ref}
          className='flex flex-1 flex-col justify-end overflow-y-auto p-4 space-y-4'
        >
          {messages.length === 0 ? (
            <div className='text-center text-sm text-muted-foreground'>
              No messages yet. Start the conversation!
            </div>
          ) : (
            <div className='space-y-1'>
              {messages.map((message, index) => {
                const prev = index > 0 ? messages[index - 1] : null;
                const showHeader =
                  !prev || prev.user.name !== message.user.name;
                return (
                  <ChatRow
                    key={message.id}
                    message={message}
                    username={username}
                    showHeader={showHeader}
                  />
                );
              })}
            </div>
          )}
        </div>
      );
    },
  ),
);

/** Input is isolated so the list does not rerender on each keypress */
function InputBar({
  disabled,
  onSend,
  isLoading,
  onStop,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  isLoading: boolean;
  onStop: () => void;
}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const maxHeightRef = useRef<number | null>(null);
  const MAX_LINES = 6;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Compute the exact max height for six lines plus vertical chrome
    if (maxHeightRef.current == null) {
      const cs = window.getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight || '0');
      const pt = parseFloat(cs.paddingTop || '0');
      const pb = parseFloat(cs.paddingBottom || '0');
      const bt = parseFloat(cs.borderTopWidth || '0');
      const bb = parseFloat(cs.borderBottomWidth || '0');
      maxHeightRef.current = Math.ceil(lh * MAX_LINES + pt + pb + bt + bb);
      el.style.maxHeight = `${maxHeightRef.current}px`;
    }

    // Auto-grow up to the cap. Then enable scrolling
    el.style.height = 'auto';
    const cap = maxHeightRef.current!;
    const next = Math.min(el.scrollHeight, cap);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  }, [value]);

  const actuallySend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled || isLoading) return;
    setValue('');
    onSend(text);
  }, [value, disabled, isLoading, onSend]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      actuallySend();
    },
    [actuallySend],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        actuallySend();
      }
    },
    [actuallySend],
  );

  return (
    <form
      onSubmit={onSubmit}
      className='sticky bottom-0 flex w-full items-center gap-2 border-t border-border bg-background p-4 mb-4'
    >
      <textarea
        ref={textareaRef}
        rows={1}
        className='flex-1 resize-none rounded-xl border bg-background px-4 py-4 text-lg leading-relaxed md:text-base md:leading-snug placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder='Type a message...'
        disabled={disabled || isLoading}
      />
      {isLoading ? (
        <Button className='rounded-full p-3' type='button' onClick={onStop}>
          <Square className='size-4' />
        </Button>
      ) : (
        !disabled &&
        value.trim() && (
          <Button
            className='rounded-full p-5'
            type='submit'
            disabled={disabled}
          >
            <Send className='size-5' />
          </Button>
        )
      )}
    </form>
  );
}

export const RealtimeChat = ({
  roomName,
  username,
  onMessage,
  messages: initialMessages = [],
}: RealtimeChatProps) => {
  const { containerRef, scrollToBottom } = useChatScroll();

  const {
    messages: realtimeMessages,
    sendMessage,
    isConnected,
  } = useRealtimeChat({
    roomName,
    username,
  });

  const [sessionId] = useState(() => crypto.randomUUID());
  const [isResponding, setIsResponding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Merge messages. O(n) dedupe. Numeric sort
  const allMessages = useMemo(() => {
    const merged = [...initialMessages, ...realtimeMessages];
    const seen = new Set<string>();
    const unique: ChatMessage[] = [];
    for (const m of merged) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      unique.push(m);
    }
    unique.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return unique;
  }, [initialMessages, realtimeMessages]);

  const typingMessage = {
    id: '__typing__',
    content: '',
    user: { name: 'assistant' },
    createdAt: new Date().toISOString(),
    typing: true,
  };

  const allMessagesWithTyping = isResponding
    ? [...allMessages, typingMessage]
    : allMessages;

  // Defer list updates so typing stays responsive
  const deferredMessages = useDeferredValue(allMessagesWithTyping);

  useEffect(() => {
    if (onMessage) onMessage(allMessages);
  }, [allMessages, onMessage]);

  useEffect(() => {
    scrollToBottom();
  }, [deferredMessages, scrollToBottom]);

  useEffect(() => {
    if (isResponding) scrollToBottom();
  }, [isResponding, scrollToBottom]);

  // Fire and forget. Clear happens inside InputBar
  const onSend = useCallback(
    (text: string) => {
      if (!text.trim() || !isConnected) return;
      void sendMessage(text);

      const controller = new AbortController();
      abortRef.current = controller;
      setIsResponding(true);

      void fetch(
        'https://justin.atlasagent.ai/webhook/5d983fb1-81cc-468a-97b1-bd143b1f5567',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: text, sessionId }),
          signal: controller.signal,
        },
      )
        .then((r) => r.json())
        .then((data) => {
          if (data?.output) {
            void sendMessage(data.output, 'assistant');
          }
        })
        .catch((err) => {
          if ((err as Error).name !== 'AbortError') {
            console.error('Failed to fetch chat response', err);
          }
        })
        .finally(() => {
          setIsResponding(false);
        });
    },
    [isConnected, sendMessage, sessionId],
  );

  const onStop = useCallback(() => {
    abortRef.current?.abort();
    setIsResponding(false);
  }, [abortRef]);

  return (
    <div className='flex h-dvh w-full flex-col bg-background text-foreground antialiased'>
      <MessagesList
        ref={containerRef}
        messages={deferredMessages}
        username={username}
      />
      <InputBar
        disabled={!isConnected}
        onSend={onSend}
        isLoading={isResponding}
        onStop={onStop}
      />
    </div>
  );
};
