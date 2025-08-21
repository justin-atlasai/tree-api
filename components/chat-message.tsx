import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/hooks/use-realtime-chat';

function UseToolHtml({ content }: { content: unknown }) {
  if (typeof content === 'string') {
    // crude check: if it looks like HTML, render it as such
    const looksLikeHtml =
      content.trim().startsWith('<') && content.trim().endsWith('>');
    if (looksLikeHtml) {
      return <div dangerouslySetInnerHTML={{ __html: content }} />;
    }
    return <>{content}</>;
  }
  try {
    return <>{JSON.stringify(content)}</>;
  } catch {
    return <>{String(content)}</>;
  }
}

interface ChatMessageItemProps {
  message: ChatMessage;
  isOwnMessage: boolean;
  showHeader: boolean;
}

export const ChatMessageItem = ({
  message,
  isOwnMessage,
  showHeader,
}: ChatMessageItemProps) => {
  return (
    <div
      className={`flex mt-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={cn('max-w-[75%] w-fit flex flex-col gap-1', {
          'items-end': isOwnMessage,
        })}
      >
        {showHeader && (
          <div
            className={cn('flex items-center gap-2 px-3', {
              'justify-end flex-row-reverse': isOwnMessage,
            })}
          >
            <span className='font-medium text-sm'>{message.user.name}</span>
            <span className='text-foreground/50 text-xs'>
              {new Date(message.createdAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })}
            </span>
          </div>
        )}
        <div
          className={cn(
            'py-2 px-3 rounded-xl text-lg md:text-base w-fit',
            isOwnMessage
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground',
          )}
        >
          {message.typing ? (
            <span className='flex space-x-1 pt-1'>
              <span className='w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.2s]' />
              <span className='w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.1s]' />
              <span className='w-1.5 h-1.5 rounded-full bg-current animate-bounce' />
            </span>
          ) : (
            <UseToolHtml content={message.content} />
          )}
        </div>
      </div>
    </div>
  );
};
