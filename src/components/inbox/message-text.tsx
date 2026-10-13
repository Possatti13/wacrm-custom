/** Linkification is a display projection: every original character stays intact. */
export function MessageText({ text }: { text: string }) {
  const parts = [];
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    let link = match[0].replace(/[.,!?;:]+$/, '');
    while (link.endsWith(')') && (link.match(/\)/g)?.length ?? 0) > (link.match(/\(/g)?.length ?? 0)) link = link.slice(0, -1);
    let safe = false;
    try { const url = new URL(link); safe = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { /* Keep malformed links as text. */ }
    parts.push(text.slice(cursor, start));
    parts.push(safe ? <a key={start} href={link} target="_blank" rel="noopener noreferrer" className="break-all font-medium underline decoration-current/50 underline-offset-2 hover:decoration-current focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2">{link}</a> : link);
    parts.push(match[0].slice(link.length));
    cursor = start + match[0].length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
