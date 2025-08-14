/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/hooks/use-realtime-chat';

type ToolCall = {
  tool: string;
  name: string;
  parameters?: unknown;
};

type ChainEnvelope = {
  chain: ToolCall[];
};

type RunContext = {
  vars: Record<string, unknown>;
};

/** parsing: convert response to JSON then normalize to an envelope */

const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

const stripFirstCodeFence = (raw: string): string => {
  // supports ```json ```json5 ```ts ```tsx and more
  const re = /```(?:json5?|javascript|js|ts|tsx)?\s*([\s\S]*?)```/i;
  const m = re.exec(raw);
  return m ? m[1].trim() : raw.trim();
};

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const coerceToolCall = (raw: unknown): ToolCall | null => {
  if (!isRecord(raw)) return null;

  const pickString = (obj: Record<string, unknown>, key: string) =>
    typeof obj[key] === 'string' ? (obj[key] as string) : null;

  // domain or tool
  const tool =
    pickString(raw, 'tool') ??
    pickString(raw, 'domain') ??
    // some payloads put the domain on raw.function.tool
    (isRecord(raw.function) ? pickString(raw.function as any, 'tool') : null);

  // name sources
  const name =
    pickString(raw, 'name') ??
    (isRecord(raw.action) ? pickString(raw.action as any, 'name') : null) ??
    (isRecord(raw.function) ? pickString(raw.function as any, 'name') : null);

  // parameters sources
  let parameters: unknown;
  if ('parameters' in raw) parameters = (raw as any).parameters;
  else if ('args' in raw) parameters = (raw as any).args;
  else if ('arguments' in raw) parameters = (raw as any).arguments;
  else if (isRecord(raw.payload)) parameters = raw.payload;

  // if function.arguments is a JSON string then parse it
  if (parameters === undefined && isRecord(raw.function)) {
    const args = (raw.function as any).arguments;
    if (typeof args === 'string') {
      const parsed = safeJsonParse(args);
      parameters = parsed ?? args;
    } else if (args !== undefined) {
      parameters = args;
    }
  }

  // allow dotted function names like ContactAndIdentity.record_consent
  if (!tool && name && name.includes('.')) {
    const [maybeTool, maybeName] = name.split('.', 2);
    if (maybeTool && maybeName) {
      return { tool: maybeTool, name: maybeName, parameters };
    }
  }

  if (tool && name) return { tool, name, parameters };

  // as a last chance: some payloads omit tool but include a nested tool field
  if (
    !tool &&
    isRecord(parameters) &&
    typeof (parameters as any).tool === 'string' &&
    name
  ) {
    return { tool: String((parameters as any).tool), name, parameters };
  }

  return null;
};

const collectCalls = (arrLike: unknown): ToolCall[] => {
  if (!Array.isArray(arrLike)) return [];
  return arrLike
    .map((v) => coerceToolCall(v))
    .filter((v): v is ToolCall => Boolean(v));
};

const toEnvelope = (val: unknown): ChainEnvelope | null => {
  // already an envelope
  if (isRecord(val) && Array.isArray(val.chain)) {
    const chain = collectCalls(val.chain);
    return { chain };
  }
  // common container keys
  if (isRecord(val)) {
    const keys = ['calls', 'tool_calls', 'tools', 'actions'];
    for (const k of keys) {
      if (Array.isArray((val as any)[k])) {
        const chain = collectCalls((val as any)[k]);
        return { chain };
      }
    }
  }
  // array of calls
  if (Array.isArray(val)) {
    const chain = collectCalls(val);
    return { chain };
  }
  // single call object
  const single = coerceToolCall(val);
  if (single) return { chain: [single] };

  return null;
};

/** accepts message.content as unknown. returns a normalized envelope or null */
function parseModelResponse(content: unknown): ChainEnvelope | null {
  // string path
  if (typeof content === 'string') {
    const unwrapped = stripFirstCodeFence(content);
    const parsed = safeJsonParse(unwrapped);
    const env = toEnvelope(parsed);
    if (env) return env;
    // try parsing the whole original if fenced parse failed
    const parsedRaw = safeJsonParse(content);
    return toEnvelope(parsedRaw);
  }

  // object path that holds a string field with JSON
  if (isRecord(content)) {
    const tryStringField = (key: string) => {
      if (typeof content[key] === 'string') {
        const unwrapped = stripFirstCodeFence(String(content[key]));
        const parsed = safeJsonParse(unwrapped);
        const env = toEnvelope(parsed);
        if (env) return env;
      }
      return null;
    };

    // strongest signals
    let env =
      tryStringField('output') ??
      tryStringField('content') ??
      tryStringField('text');

    if (env) return env;

    // if none matched try toEnvelope on the object itself
    env = toEnvelope(content);
    if (env) return env;

    // look inside a message field
    if (isRecord(content.message)) {
      env =
        tryStringField.call(content.message as any, 'content') ??
        toEnvelope(content.message);
      if (env) return env;
    }
  }

  return null;
}

/** simple placeholder resolver */

function resolvePlaceholders<T>(val: T, ctx: RunContext): T {
  if (typeof val === 'string') {
    const m = /^<([^>]+)>$/.exec(val);
    if (m) {
      const key = m[1];
      if (key in ctx.vars) return ctx.vars[key] as T;
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((v) => resolvePlaceholders(v, ctx)) as unknown as T;
  }
  if (isRecord(val)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(val)) out[k] = resolvePlaceholders(val[k], ctx);
    return out as unknown as T;
  }
  return val;
}

const esc = (v: unknown) =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function section(title: string, body: string) {
  return `
    <section class="rounded-lg p-3 bg-foreground/5 space-y-2">
      <div class="font-semibold">${esc(title)}</div>
      <div>${body}</div>
    </section>
  `;
}

function setVar(ctx: RunContext, key: string, value: unknown) {
  ctx.vars[key] = value;
  if (typeof key === 'string' && key.endsWith('_url')) {
    const base = key.replace(/_url$/, '');
    ctx.vars[base] = value;
  }
}

/** handlers: map tool and name to UI blocks */

type Handler = (params: unknown, ctx: RunContext) => Promise<string>;

const notImplemented: Handler = async (params) => {
  const body = `<pre class="text-xs bg-foreground/10 p-2 rounded">${esc(JSON.stringify(params, null, 2))}</pre>`;
  return section('Handler missing', body);
};

function handlerFor(tool: string, name: string): Handler {
  switch (tool) {
    case 'ContactAndIdentity': {
      switch (name) {
        case 'create_vcard':
          return async (params, ctx) => {
            const p = resolvePlaceholders(params as any, ctx) as any;
            const id = Math.random().toString(36).slice(2);
            const vcardUrl = `https://example.com/vcard/${id}.vcf`;
            setVar(ctx, 'vcard_url', vcardUrl);
            const body = `
              <div>Name: <strong>${esc(p.full_name || '')}</strong></div>
              <div>Email: <strong>${esc(p.email || '')}</strong></div>
              <div class="mt-2"><a class="underline" href="${esc(vcardUrl)}" target="_blank">Download vCard</a></div>
            `;
            return section('vCard', body);
          };
        case 'build_link_hub':
          return async (params, ctx) => {
            const p = resolvePlaceholders(params as any, ctx) as any;
            const list = Array.isArray(p.links)
              ? p.links
                  .map(
                    (l: any) =>
                      `<li><a class="underline" href="${esc(l.url)}" target="_blank">${esc(l.label)}</a></li>`,
                  )
                  .join('')
              : '';
            const body = `
              <ol class="list-decimal ml-5 space-y-1 mt-2">${list}</ol>
            `;
            return section('My Links', body);
          };
        case 'shorten_url':
          return async (params, ctx) => {
            const p = resolvePlaceholders(params as any, ctx) as any;
            const base = 'https://sho.rt';
            const slug = Math.random().toString(36).slice(2, 8);
            const shortUrl = `${base}/${slug}`;
            const label =
              typeof p.label === 'string' && p.label ? p.label : 'short';
            setVar(ctx, `${label}_short_url`, shortUrl);
            setVar(ctx, 'last_short_url', shortUrl);
            const body = `
              <div>Original: <span class="opacity-80 break-all">${esc(p.long_url || '')}</span></div>
              <div>Short: <a class="underline" href="${esc(shortUrl)}" target="_blank">${esc(shortUrl)}</a></div>
              <div>Label: <code class="px-1 rounded bg-foreground/10">${esc(label)}</code></div>
            `;
            return section('URL shortened', body);
          };
        case 'create_qr_code':
          return async (params, ctx) => {
            const p = resolvePlaceholders(params as any, ctx) as any;
            const target = typeof p.target_url === 'string' ? p.target_url : '';
            const px = typeof p.size_px === 'number' ? p.size_px : 256;
            const src = `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&data=${encodeURIComponent(target)}`;
            setVar(ctx, 'qr_image_url', src);
            const body = `
              <div class="mb-2">Target: <a class="underline" href="${esc(target)}" target="_blank">${esc(target)}</a></div>
              <img src="${esc(src)}" alt="QR code" width="${px}" height="${px}" />
            `;
            return section('QR code', body);
          };
        case 'record_consent':
          return async (params, ctx) => {
            const p = resolvePlaceholders(params as any, ctx) as any;
            const id = Math.random().toString(36).slice(2, 10);
            setVar(ctx, 'consent_id', id);
            const body = `
              <div>Email: <strong>${esc(p.email || '')}</strong></div>
              <div>Intent: <strong>${esc(p.intent || '')}</strong></div>
              <div>Source: <strong>${esc(p.source || '')}</strong></div>
              <div class="mt-1 text-xs opacity-70">Consent id: ${esc(id)}</div>
            `;
            return section('Consent recorded', body);
          };
        default:
          return notImplemented;
      }
    }

    case 'Communication': {
      switch (name) {
        case 'send_email':
          return async (params, ctx) => {
            const p = resolvePlaceholders(params as any, ctx) as any;
            if (!p.to_email) {
              return section(
                'Email needed',
                `<div>What is your best email</div>`,
              );
            }
            const draftId = Math.random().toString(36).slice(2, 10);
            setVar(ctx, 'email_draft_id', draftId);
            const attachments = Array.isArray(p.attachments)
              ? p.attachments
              : [];
            const att = attachments
              .map(
                (a: string) =>
                  `<li class="ml-5 list-disc">${esc(String(a))}</li>`,
              )
              .join('');
            const body = `
              <div>To: <strong>${esc(p.to_email)}</strong></div>
              <div>Subject: <strong>${esc(p.subject || '')}</strong></div>
              <div>Draft created. Id: <code class="px-1 rounded bg-foreground/10">${esc(draftId)}</code></div>
              ${att ? `<div class="mt-2">Attachments</div><ul>${att}</ul>` : ''}
            `;
            return section('Email prepared', body);
          };
        case 'crm_upsert_contact':
          return async (params, ctx) => {
            const p = resolvePlaceholders(params as any, ctx) as any;
            const crmId = Math.random().toString(36).slice(2, 10);
            setVar(ctx, 'crm_id', crmId);
            const body = `
              <div>Email: <strong>${esc(p.email || '')}</strong></div>
              <div>Source: <strong>${esc(p.source || '')}</strong></div>
              <div>Tags: <code class="px-1 rounded bg-foreground/10">${esc(JSON.stringify(p.tags || []))}</code></div>
              <div class="mt-1 text-xs opacity-70">CRM id: ${esc(crmId)}</div>
            `;
            return section('CRM updated', body);
          };
        default:
          return notImplemented;
      }
    }

    case 'TrackingAndAnalytics': {
      switch (name) {
        case 'track_event':
          return async (params) => {
            console.log(params);
            return '';
          };
        default:
          return notImplemented;
      }
    }

    case 'ContentAndAsset': {
      switch (name) {
        case 'generate_one_pager':
          return async (params, ctx) => {
            const p = resolvePlaceholders(params as any, ctx) as any;
            const id = Math.random().toString(36).slice(2);
            const pdfUrl = `https://example.com/files/onepager_${id}.pdf`;
            setVar(ctx, 'pdf_url', pdfUrl);
            const body = `
              <div>Audience: <strong>${esc(p.audience || '')}</strong></div>
              <div>Pricing: <strong>${String(!!p.include_pricing_ranges)}</strong></div>
              <div>Cases: <code class="px-1 rounded bg-foreground/10">${esc(JSON.stringify(p.case_studies || []))}</code></div>
              <div class="mt-2"><a class="underline" href="${esc(pdfUrl)}" target="_blank">Open PDF</a></div>
            `;
            return section('One pager generated', body);
          };
        case 'save_file':
          return async (params, ctx) => {
            const p = resolvePlaceholders(params as any, ctx) as any;
            const savedUrl = p.file_url || '#';
            setVar(ctx, 'saved_url', savedUrl);
            const body = `
              <div>Saved as: <strong>${esc(p.file_name || 'file.pdf')}</strong></div>
              <div>URL: <a class="underline" href="${esc(savedUrl)}" target="_blank">${esc(savedUrl)}</a></div>
            `;
            return section('File saved', body);
          };
        default:
          return notImplemented;
      }
    }

    default:
      return notImplemented;
  }
}

/** orchestrator */

async function runChain(envelope: ChainEnvelope): Promise<string> {
  const ctx: RunContext = { vars: {} };
  const out: string[] = [];
  for (const call of envelope.chain) {
    const handler = handlerFor(call.tool, call.name);
    const params = call.parameters ?? {};
    const html = await handler(params, ctx);
    out.push(html);
  }
  return `<div class="space-y-3">${out.join('')}</div>`;
}

/** builds HTML from a message content value */

async function buildHtmlFromMessageContent(
  content: unknown,
): Promise<string | null> {
  const env = parseModelResponse(content);
  if (!env || !env.chain || env.chain.length === 0) return null;
  return runChain(env);
}

/** React wrapper that plugs into your bubble */

function UseToolHtml({ content }: { content: unknown }) {
  const [html, setHtml] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const result = await buildHtmlFromMessageContent(content);
      if (mounted) setHtml(result);
    })();
    return () => {
      mounted = false;
    };
  }, [content]);

  if (!html) {
    if (typeof content === 'string') return <>{content}</>;
    try {
      return <>{JSON.stringify(content)}</>;
    } catch {
      return <>{String(content)}</>;
    }
  }
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** chat message item */

interface ChatMessageItemProps {
  message: ChatMessage;
  isOwnMessage: boolean;
  showHeader: boolean;
}

export const ChatMessageItem2 = ({
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
            <span className={'font-medium text-sm'}>{message.user.name}</span>
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
