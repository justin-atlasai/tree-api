"use client";

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
} from "react";

import { ChatMessageItem } from "@/components/chat-message";
import { useChatScroll } from "@/hooks/use-chat-scroll";
import { type ChatMessage, useRealtimeChat } from "@/hooks/use-realtime-chat";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

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
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
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
          className="flex flex-1 flex-col justify-end overflow-y-auto p-4 space-y-4"
        >
          {messages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground">
              No messages yet. Start the conversation!
            </div>
          ) : (
            <div className="space-y-1">
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
    }
  )
);

/** Input is isolated so the list does not rerender on each keypress */
function InputBar({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const actuallySend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onSend(text);
  }, [value, disabled, onSend]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      actuallySend();
    },
    [actuallySend]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        actuallySend();
      }
    },
    [actuallySend]
  );

  return (
    <form
      onSubmit={onSubmit}
      className="sticky bottom-0 flex w-full items-end gap-2 border-t border-border bg-background p-4"
    >
      <textarea
        ref={textareaRef}
        rows={1}
        className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type a message..."
        disabled={disabled}
      />
      {!disabled && value.trim() && (
        <Button className="rounded-full p-2" type="submit" disabled={disabled}>
          <Send className="size-4" />
        </Button>
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
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return unique;
  }, [initialMessages, realtimeMessages]);

  // Defer list updates so typing stays responsive
  const deferredMessages = useDeferredValue(allMessages);

  useEffect(() => {
    if (onMessage) onMessage(allMessages);
  }, [allMessages, onMessage]);

  useEffect(() => {
    scrollToBottom();
  }, [deferredMessages, scrollToBottom]);

  // Fire and forget. Clear happens inside InputBar
  const onSend = useCallback(
    (text: string) => {
      if (!text.trim() || !isConnected) return;
      void sendMessage(text);

      void fetch(
        "https://justin.atlasagent.ai/webhook/5d983fb1-81cc-468a-97b1-bd143b1f5567",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: text, sessionId }),
        }
      )
        .then((r) => r.json())
        .then((data) => {
          if (data?.output) {
            void sendMessage(data.output, "assistant");
          }
        })
        .catch((err) => {
          console.error("Failed to fetch chat response", err);
        });
    },
    [isConnected, sendMessage, sessionId]
  );

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground antialiased">
      <MessagesList
        ref={containerRef}
        messages={deferredMessages}
        username={username}
      />
      <InputBar disabled={!isConnected} onSend={onSend} />
    </div>
  );
};
