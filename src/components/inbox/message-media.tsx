"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated blobs and provider URLs use native decoding; no image optimization proxy is introduced. */

import { useEffect, useRef, useState } from 'react';
import { FileText, ImageOff, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MessageText } from './message-text';

/** Existing assets only. No arbitrary schemes, credentials or protocol-relative URLs. */
function usableUrl(url: string): boolean {
  if (/^\/(?!\/)/.test(url) && !/[\\\u0000-\u0020]/.test(url)) return true;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function MediaUnavailable({ label, retry }: { label: string; retry?: () => void }) {
  return <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-3 text-sm">
    <ImageOff aria-hidden className="h-4 w-4 shrink-0 opacity-70" />
    <div className="min-w-0">
      <p className="break-words font-medium">{label}</p>
      {retry && <button type="button" onClick={retry} className="mt-1 rounded-sm text-xs underline underline-offset-4 opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2">Tentar novamente</button>}
    </div>
  </div>;
}

function MediaLoading({ label }: { label: string }) {
  return <div role="status" className="absolute inset-0 flex items-center justify-center rounded-lg bg-muted motion-safe:animate-pulse"><span className="sr-only">{label}</span></div>;
}

function ImageAttempt({ url }: { url: string }) {
  const proxy = url.startsWith('/api/whatsapp/media/');
  const [src, setSrc] = useState<string | null>(proxy ? null : url);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expandedFailed, setExpandedFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (image.current?.complete) {
        if (image.current.naturalWidth > 0) setLoaded(true);
        else setFailed(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [src, attempt]);

  useEffect(() => {
    if (!proxy) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Media unavailable');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, proxy, attempt]);

  function retry() {
    setFailed(false); setLoaded(false); setExpandedFailed(false);
    if (proxy) setSrc(null);
    setAttempt(value => value + 1);
  }

  if (failed) return <MediaUnavailable label="Imagem indisponível" retry={retry} />;
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (value) setExpandedFailed(false); }}>
    <div className="relative w-72 max-w-full rounded-lg bg-muted/30">
      <DialogTrigger ref={trigger} disabled={!loaded} aria-label="Ampliar imagem" className="block w-full cursor-zoom-in overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default">
        {/* Native image events reflect decoding; proxy fetch completion alone is not readiness. */}
        {src && <img ref={image} key={attempt} src={src} alt="Imagem da conversa" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className={`block max-h-72 w-full object-contain ${loaded ? '' : 'absolute inset-0 invisible'}`} />}
        {!loaded && <div className="h-44"><MediaLoading label="Carregando imagem" /></div>}
      </DialogTrigger>
    </div>
    <DialogContent showCloseButton={false} finalFocus={trigger} className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl flex-col gap-3 overflow-hidden p-3 pt-12 sm:max-w-5xl">
      <DialogTitle className="sr-only">Visualização da imagem</DialogTitle>
      <DialogDescription className="sr-only">Imagem compartilhada nesta conversa.</DialogDescription>
      <DialogClose aria-label="Fechar imagem" className="absolute right-3 top-2 flex h-9 w-9 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-2"><X aria-hidden className="h-5 w-5" /></DialogClose>
      {expandedFailed ? <MediaUnavailable label="Imagem indisponível" /> : src && <img src={src} alt="Imagem ampliada da conversa" onError={() => setExpandedFailed(true)} className="min-h-0 w-full object-contain max-h-[calc(100dvh-7rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]" />}
    </DialogContent>
  </Dialog>;
}

export function MediaImage({ url }: { url: string }) {
  // HTTPS pages cannot safely render plain HTTP media. Do not proxy or rewrite providers here.
  if (!usableUrl(url) || (typeof window !== 'undefined' && window.location.protocol === 'https:' && url.startsWith('http:'))) return <MediaUnavailable label="Imagem indisponível" />;
  return <ImageAttempt key={url} url={url} />;
}

function Player({ kind, url }: { kind: 'audio' | 'video'; url: string }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const player = useRef<HTMLMediaElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (player.current?.error) setFailed(true);
      else if (player.current && player.current.readyState >= 1) setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const label = kind === 'audio' ? 'Áudio' : 'Vídeo';
  if (failed) return <MediaUnavailable label={`${label} indisponível`} />;
  const props = { src: url, controls: true, preload: 'metadata', onLoadedMetadata: () => setReady(true), onCanPlay: () => setReady(true), onError: () => setFailed(true), 'aria-label': `${label} da conversa` };
  return <div className="w-72 max-w-full rounded-lg bg-muted/30">
    {!ready && <div role="status" className="px-3 py-2 text-xs opacity-70">Carregando {kind === 'audio' ? 'áudio' : 'vídeo'}</div>}
    {kind === 'audio' ? <audio ref={element => { player.current = element; }} {...props} className="block h-12 w-full min-w-0 max-w-full" /> : <video ref={element => { player.current = element; }} {...props} className="block max-h-72 w-full max-w-full rounded-lg object-contain" />}
  </div>;
}

export function MediaPlayer({ kind, url }: { kind: 'audio' | 'video'; url: string }) {
  if (!usableUrl(url) || (typeof window !== 'undefined' && window.location.protocol === 'https:' && url.startsWith('http:'))) return <MediaUnavailable label={kind === 'audio' ? 'Áudio indisponível' : 'Vídeo indisponível'} />;
  return <Player key={url} kind={kind} url={url} />;
}

export function MediaDocument({ url, caption }: { url?: string; caption: string | null }) {
  // Message has no separate file metadata. Composer already saves the filename as content_text.
  const filename = caption && /^[^\n/\\]+\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|odt)$/i.test(caption) ? caption : null;
  const safe = Boolean(url && usableUrl(url));
  return <>
    <div className="flex w-72 max-w-full min-w-0 items-center gap-3 rounded-lg bg-muted/40 px-3 py-3">
      <FileText aria-hidden className="h-5 w-5 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={filename ?? undefined}>{filename || 'Documento'}</p>
        {filename && <p className="mt-0.5 text-[11px] opacity-70">{filename.split('.').pop()!.toUpperCase()}</p>}
        {!safe && <p className="mt-0.5 text-xs opacity-70">Documento indisponível</p>}
      </div>
      {safe && <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir documento" className="shrink-0 rounded-sm text-xs font-medium underline underline-offset-4 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2">Abrir</a>}
    </div>
    {caption && !filename && <p className="mt-1 whitespace-pre-wrap break-words text-sm"><MessageText text={caption} /></p>}
  </>;
}
