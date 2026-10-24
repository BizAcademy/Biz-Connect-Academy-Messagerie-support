import { useEffect, useRef, useState } from "react";
import { Download, ImageOff, MoreVertical, Pause, Play, Share2, X } from "lucide-react";
import { useBlobUrl } from "@/hooks/use-app";
import { formatDuration, initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { BrandLogo } from "@/components/brand-logo";
import { RATES, applyRate, pauseOthers, rateLabel } from "./voice-draft-player";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const protect = {
  onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  onDragStart: (e: React.DragEvent) => e.preventDefault(),
  draggable: false,
};

export function UserAvatar({
  name,
  src,
  size = 44,
  online,
  team,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  online?: boolean;
  team?: boolean;
  className?: string;
}) {
  const { url } = useBlobUrl(src);
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <div
        className={cn(
          "h-full w-full overflow-hidden rounded-full grid place-items-center font-semibold text-white protected-media",
          team && "ring-2 ring-[#D4AF37] ring-offset-2 ring-offset-background",
        )}
        style={{
          background: team
            ? "linear-gradient(140deg,#0B1B3F,#1E5EFF)"
            : `linear-gradient(140deg,hsl(${hue} 55% 46%),hsl(${(hue + 40) % 360} 60% 36%))`,
          fontSize: size * 0.36,
        }}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" {...protect} />
        ) : team ? (
          <BrandLogo className="h-full w-full" />
        ) : (
          initials(name)
        )}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full border-2 border-background transition-colors",
            online ? "bg-[#16A34A]" : "bg-muted-foreground/40",
          )}
          style={{ width: size * 0.28, height: size * 0.28 }}
          data-testid="status-online"
        />
      )}
    </div>
  );
}

export function ImageThumb({ src, onOpen }: { src: string; onOpen: (url: string, blob: Blob) => void }) {
  const { url, blob, error } = useBlobUrl(src);
  if (error)
    return (
      <div className="grid h-40 w-56 place-items-center rounded-xl bg-black/15 text-xs text-white/80">
        <ImageOff className="mb-1 h-5 w-5" />
        Image indisponible
      </div>
    );
  if (!url || !blob) return <div className="h-48 w-60 animate-pulse rounded-xl bg-white/15" />;
  return (
    <button
      type="button"
      onClick={() => onOpen(url, blob)}
      className="block overflow-hidden rounded-xl"
      data-testid="button-open-image"
    >
      <img
        src={url}
        alt="Image partagée"
        className="max-h-80 w-auto max-w-[min(18rem,70vw)] object-cover protected-media transition-transform duration-300 hover:scale-[1.02]"
        {...protect}
      />
    </button>
  );
}

export function ImageViewer({ url, blob, onClose }: { url: string; blob: Blob; onClose: () => void }) {
  const { toast } = useToast();
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  const name = `biz-connect-${Date.now()}.${ext}`;
  const file = typeof File !== "undefined" ? new File([blob], name, { type: blob.type }) : null;
  const canShare = !!file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

  const save = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const share = async () => {
    try {
      await navigator.share({ files: [file!], title: "BCA Messenger" });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast({ title: "Partage impossible", variant: "destructive" });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-[#060B18]/95 backdrop-blur-sm protected-media animate-in fade-in duration-200"
      onContextMenu={(e) => e.preventDefault()}
      data-testid="viewer-image"
    >
      <div className="flex items-center justify-between px-3 py-3 text-white" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10" aria-label="Fermer" data-testid="button-close-viewer">
          <X className="h-5 w-5" />
        </button>
        <span className="text-xs uppercase tracking-[0.2em] text-white/50">Image privée</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10" aria-label="Options" data-testid="button-viewer-menu">
              <MoreVertical className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[90]">
            <DropdownMenuItem onClick={save} data-testid="menu-save-image">
              <Download className="mr-2 h-4 w-4" /> Enregistrer
            </DropdownMenuItem>
            {canShare && (
              <DropdownMenuItem onClick={share} data-testid="menu-share-image">
                <Share2 className="mr-2 h-4 w-4" /> Partager
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img
          src={url}
          alt="Image en plein écran"
          onClick={() => setZoom((z) => !z)}
          className={cn(
            "rounded-lg object-contain shadow-2xl transition-transform duration-300 animate-in zoom-in-95",
            zoom ? "max-h-none max-w-none scale-150 cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in",
          )}
          {...protect}
        />
      </div>
    </div>
  );
}

export function AudioPlayer({ src, duration, mine }: { src: string; duration: number | null; mine: boolean }) {
  const { url, error } = useBlobUrl(src);
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [len, setLen] = useState(duration ?? 0);
  const [rate, setRate] = useState<number>(1);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const bars = useRef(Array.from({ length: 24 }, (_, i) => 0.3 + Math.abs(Math.sin(i * 1.7 + src.length)) * 0.7)).current;
  const pct = len > 0 ? Math.min(1, pos / len) : 0;

  useEffect(() => applyRate(ref.current, rate), [rate, url]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      pauseOthers(a);
      applyRate(a, rateRef.current);
      void a.play().catch(() => undefined);
    } else a.pause();
  };
  const cycleRate = () => setRate((r) => RATES[(RATES.indexOf(r as (typeof RATES)[number]) + 1) % RATES.length]!);
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = ref.current;
    if (!a || !len) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * len;
    setPos(a.currentTime);
    applyRate(a, rateRef.current);
  };

  return (
    <div className="flex w-56 max-w-[62vw] items-center gap-2 py-0.5" data-testid="audio-player">
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[#0B1B3F] shadow-sm transition-transform active:scale-90 disabled:opacity-50"
        style={{ color: mine ? "#1E5EFF" : "#16A34A" }}
        aria-label={playing ? "Pause" : "Lecture"}
        data-testid="button-play-audio"
      >
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-7 cursor-pointer touch-none items-center gap-[2px] overflow-hidden" onPointerDown={seek} data-testid="audio-seek">
          {bars.map((b, i) => (
            <span
              key={i}
              className={cn("w-[3px] shrink-0 rounded-full transition-colors", i / bars.length < pct ? "bg-white" : "bg-white/35")}
              style={{ height: `${b * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-0.5 text-[11px] font-mono-num text-white/85" data-testid="text-audio-time">
          {error ? "Audio indisponible" : playing || pos > 0 ? `${formatDuration(pos)} / ${formatDuration(len)}` : formatDuration(len)}
        </div>
      </div>
      <button
        type="button"
        onClick={cycleRate}
        disabled={!url}
        className="h-7 min-w-[2.6rem] shrink-0 rounded-full bg-white/20 px-1.5 text-[11px] font-bold font-mono-num text-white transition active:scale-90 disabled:opacity-50"
        aria-label={`Vitesse de lecture ${rateLabel(rate)}, changer`}
        data-testid="button-audio-rate"
      >
        {rateLabel(rate)}
      </button>
      {url && (
        <audio
          ref={ref}
          src={url}
          preload="metadata"
          onPlay={(e) => {
            pauseOthers(e.currentTarget);
            applyRate(e.currentTarget, rateRef.current);
            setPlaying(true);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onRateChange={(e) => e.currentTarget.playbackRate !== rateRef.current && applyRate(e.currentTarget, rateRef.current)}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            applyRate(e.currentTarget, rateRef.current);
            if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) setLen(e.currentTarget.duration);
          }}
        />
      )}
    </div>
  );
}
