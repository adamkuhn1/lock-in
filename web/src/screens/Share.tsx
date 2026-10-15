import { Share2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTodayStats } from '../data/useTodayStats';
import { CARD_H, CARD_W, caption, drawCard, toCardData } from '../lib/shareCard';
import { Button, Card, CopyButton, LoadError, Skeleton } from '../ui/primitives';

const FAIL = "Couldn't make the image.";

async function loadFonts() {
  try {
    await Promise.all([
      document.fonts?.load('italic 800 100px "Barlow Condensed"'),
      document.fonts?.load('800 100px "Barlow Condensed"'),
      document.fonts?.load('500 40px "Barlow Condensed"'),
    ]);
  } catch { /* draw with fallbacks */ }
}

export default function Share() {
  const { state, retry, stats } = useTodayStats();
  const [showFunnel, setShowFunnel] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The PNG is rendered after each draw, so share() can call navigator.share without awaiting
  // anything first (iOS Safari drops the user gesture across an await).
  const png = useRef<{ blob: Blob; file: File } | null>(null);
  const [ready, setReady] = useState(false);
  const data = useMemo(() => (stats ? toCardData(stats, showFunnel) : null), [stats, showFunnel]);
  const key = data ? JSON.stringify(data) : '';

  useEffect(() => {
    if (!data || !canvas.current) return;
    let alive = true;
    const ctx = canvas.current.getContext('2d');
    png.current = null;
    setReady(false);
    if (!ctx) { setErr(FAIL); return; }
    const c = canvas.current;
    void loadFonts().then(() => {
      if (!alive) return;
      drawCard(ctx, data);
      setErr(null);
      c.toBlob((blob) => {
        if (!alive) return;
        if (!blob) { setErr(FAIL); return; }
        png.current = { blob, file: new File([blob], `lock-in-day-${data.day}.png`, { type: 'image/png' }) };
        setReady(true);
      }, 'image/png');
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures `data` by value
  }, [key]);

  if (state === 'loading') return <Skeleton label="Loading card" />;
  if (state === 'error' || !stats || !data) return <LoadError what="today" onRetry={retry} />;

  const share = () => {
    const p = png.current;
    if (!p) return;
    if (navigator.canShare?.({ files: [p.file] })) {
      navigator.share({ files: [p.file], text: caption(data) }).catch((e: unknown) => {
        if ((e as { name?: string } | null)?.name !== 'AbortError') setErr(FAIL);
      });
      return;
    }
    const url = URL.createObjectURL(p.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = p.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Safari/iOS can cancel the download if the URL is revoked right after click(), so wait.
    window.setTimeout(() => URL.revokeObjectURL(url), 40_000);
  };

  return (
    <div className="screen">
      <header className="screen-head"><h1>Share</h1></header>
      <Card data-primary aria-labelledby="card-h">
        <h2 id="card-h" className="sr-only">Today's card</h2>
        <canvas ref={canvas} width={CARD_W} height={CARD_H} className="share-canvas" role="img"
          aria-label={`Day ${data.day} card: ${data.streak} day streak, ${data.lcDone} of ${data.lcTotal} LeetCode, ${data.appsWeek} apps this week`} />
        {err && <p role="alert" className="error small">{err}</p>}
        <label className="check-row">
          <input type="checkbox" checked={showFunnel} onChange={(e) => setShowFunnel(e.target.checked)} />
          <span>Show funnel</span>
        </label>
        <div className="row-actions">
          <Button variant="primary" disabled={!ready} onClick={share}><Share2 size={18} aria-hidden />Share image</Button>
          <CopyButton text={caption(data)} label="Copy caption" variant="ghost" />
        </div>
        <p className="muted small share-caption">{caption(data)}</p>
      </Card>
    </div>
  );
}
