import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { formatDuration } from "@/lib/chat-utils";

export const RATES = [1, 1.5, 2] as const;
export const rateLabel = (r: number) => (r === 1.5 ? "1,5×" : `${r}×`);

export function applyRate(a: HTMLAudioElement | null, rate: number) {
  if (!a) return;
  const x = a as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
  x.preservesPitch = true;
  x.webkitPreservesPitch = true;
  x.mozPreservesPitch = true;
  a.defaultPlaybackRate = rate;
  a.playbackRate = rate;
}

export function pauseOthers(a: HTMLAudioElement) {
  document.querySelectorAll("audio").forEach((o) => o !== a && !o.paused && o.pause());
}

/** Local preview of an unsent recording (object URL, never uploaded). */
export function VoiceDraftPlayer({ url, duration }: { url: string; duration: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const pct = duration > 0 ? Math.min(1, pos / duration) : 0;

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      pauseOthers(a);
      void a.play().catch(() => undefined);
    } else a.pause();
  };
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = ref.current;
    if (!a || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
    setPos(a.currentTime);
  };

  return (
    <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted pl-1 pr-3" data-testid="player-voice-draft">
      <button
        type="button"
        onClick={toggle}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-out text-white transition active:scale-90"
        aria-label={playing ? "Pause de l'aperçu" : "Écouter l'aperçu"}
        data-testid="button-play-voice-draft"
      >
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div
        className="relative h-1.5 min-w-0 flex-1 cursor-pointer touch-none rounded-full bg-foreground/15"
        onPointerDown={seek}
        role="slider"
        aria-label="Position de lecture"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(pos)}
      >
        <div className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-out" style={{ transform: `scaleX(${pct})` }} />
      </div>
      <span className="shrink-0 font-mono-num text-xs text-muted-foreground" data-testid="text-voice-draft-duration">
        {playing || pos > 0 ? `${formatDuration(pos)} / ` : ""}
        {formatDuration(duration)}
      </span>
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => setPos(Math.min(duration, e.currentTarget.currentTime))}
      />
    </div>
  );
}
