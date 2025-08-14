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

/** ---------- parsing: convert entire response to JSON then read real keys ---------- */

const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

const stripFirstCodeFence = (raw: string): string => {
  const re = /```(?:json)?\s*([\s\S]*?)```/i;
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

const toEnvelope = (val: unknown): ChainEnvelope | null => {
  // case: val is already { chain: [...] }
  if (isRecord(val) && Array.isArray(val.chain)) {
    const chain = val.chain.filter(isToolCall);
    return { chain };
  }
  // case: val is an array of tool calls
  if (Array.isArray(val)) {
    const chain = val.filter(isToolCall);
    return { chain };
  }
  return null;
};

const isToolCall = (v: unknown): v is ToolCall => {
  if (!isRecord(v)) return false;
  return typeof v.tool === 'string' && typeof v.name === 'string';
};

/** Accepts message.content as unknown. Returns a normalized envelope or null */
function parseModelResponse(content: unknown): ChainEnvelope | null {
  // If content is a string: try to parse as JSON or fenced JSON
  if (typeof content === 'string') {
    const unwrapped = stripFirstCodeFence(content);
    const parsed = safeJsonParse(unwrapped);
    return toEnvelope(parsed);
  }

  // If content is an object: look for a string field that holds the JSON
  if (isRecord(content)) {
    // Strongest signal: output field like your example
    if (typeof content.output === 'string') {
      const unwrapped = stripFirstCodeFence(content.output);
      const parsed = safeJsonParse(unwrapped);
      const env = toEnvelope(parsed);
      if (env) return env;
    }

    // Some stacks use content.content
    if (typeof content.content === 'string') {
      const unwrapped = stripFirstCodeFence(content.content);
      const parsed = safeJsonParse(unwrapped);
      const env = toEnvelope(parsed);
      if (env) return env;
    }

    // As a fallback: the object itself might already be the envelope
    const env = toEnvelope(content);
    if (env) return env;
  }

  return null;
}

/** ---------- tiny placeholder resolver for strings like "<hub_url>" ---------- */

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

/** ---------- handlers: switch by tool then name ---------- */

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

/** ---------- orchestrator ---------- */

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

/** Runs when the message is not typing. Returns HTML or null */
async function buildHtmlFromMessageContent(
  content: unknown,
): Promise<string | null> {
  const env = parseModelResponse(content);
  if (!env || !env.chain || env.chain.length === 0) return null;
  return runChain(env);
}

/** ---------- React wrapper that plugs into your bubble ---------- */

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

/** ---------- your original component with a single change inside the bubble ---------- */

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
