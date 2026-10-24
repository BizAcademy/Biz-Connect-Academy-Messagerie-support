import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUp, ChevronLeft, ChevronUp, ImagePlus, Loader2, Lock, Mic, Pause, RotateCw, Send, Square, Trash2, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGetSummaryQueryKey,
  uploadFile,
  useUploadFile,
  type Message,
  type MessageInput,
} from "@workspace/api-client-react";
import { compressImage, formatDuration } from "@/lib/chat-utils";
import { errorMessage } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useRealtime } from "@/components/realtime";
import { cn } from "@/lib/utils";
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, useVoiceRecorder, type RecorderError } from "./use-voice-recorder";
import { VoiceDraftPlayer } from "./voice-draft-player";
import { appendRealtimeMessage } from "@/lib/realtime-cache";

const LOCK_DY = 64;
const CANCEL_DX = 110;
const UPLOAD_DEADLINE = 90_000;
const SEND_DEADLINE = 25_000;

type VoiceDraft = { conversationId: string; blob: Blob; url: string; duration: number; fileId?: string; replyToId?: string; clientMessageId: string };
type VoiceSend = { status: "idle" | "uploading" | "sending" | "error"; error?: string };

async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, outer: AbortSignal): Promise<T> {
  if (outer.aborted) throw new DOMException("Envoi annulé.", "AbortError");
  const ctl = new AbortController();
  let rejectBounded!: (error: Error) => void;
  const bounded = new Promise<never>((_, reject) => { rejectBounded = reject; });
  const onAbort = () => {
    rejectBounded(new DOMException("Envoi annulé.", "AbortError"));
    ctl.abort();
  };
  outer.addEventListener("abort", onAbort, { once: true });
  const t = setTimeout(() => {
    rejectBounded(new Error("Délai dépassé. Vérifiez votre connexion puis réessayez."));
    ctl.abort();
  }, ms);
  try {
    return await Promise.race([run(ctl.signal), bounded]);
  } finally {
    clearTimeout(t);
    outer.removeEventListener("abort", onAbort);
  }
}

export function Composer({ conversationId, replyTo, onClearReply }: { conversationId: string; replyTo?: Message | null; onClearReply?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { status, emitTyping, sendRealtimeMessage } = useRealtime();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingOn = useRef(false);
  const pendingSend = useRef<{ fingerprint: string; id: string } | null>(null);

  const send = useMutation({ mutationFn: ({ id, data }: { id: string; data: MessageInput }) => sendRealtimeMessage(id, data) });
  const upload = useUploadFile();
  const busy = send.isPending || upload.isPending;

  const pushMessage = (m: Message) => {
    appendRealtimeMessage(qc, m);
    onClearReply?.();
    if (status !== "online") {
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/conversations" });
      void qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
    }
  };
  const sendData = (data: MessageInput, onDone?: () => void) => {
    const payload = { ...data, ...(replyTo ? { replyToId: replyTo.id } : {}) };
    const fingerprint = JSON.stringify([conversationId, payload]);
    if (pendingSend.current?.fingerprint !== fingerprint) pendingSend.current = { fingerprint, id: crypto.randomUUID() };
    const clientMessageId = pendingSend.current.id;
    send.mutate(
      { id: conversationId, data: { ...payload, clientMessageId } },
      {
        onSuccess: (m) => {
          if (pendingSend.current?.id === clientMessageId) pendingSend.current = null;
          pushMessage(m);
          onDone?.();
        },
        onError: (e) => toast({ title: "Message non envoyé", description: errorMessage(e), variant: "destructive" }),
      },
    );
  };

  const stopTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (typingOn.current) emitTyping(conversationId, false);
    typingOn.current = false;
  };
  useEffect(() => () => stopTyping(), [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onText = (v: string) => {
    setText(v);
    if (!v.trim()) stopTyping();
    if (v.trim()) {
      typingOn.current = true;
      emitTyping(conversationId, true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 2500);
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    }
  };

  const submitText = () => {
    const content = text.trim();
    if (!content || busy) return;
    stopTyping();
    sendData({ type: "text", content }, () => {
      setText("");
      if (taRef.current) taRef.current.style.height = "auto";
    });
  };

  const pickImage = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast({ title: "Format non pris en charge", description: "Choisissez une image.", variant: "destructive" });
      return;
    }
    setPreparing(true);
    try {
      const blob = await compressImage(f);
      setPreview({ blob, url: URL.createObjectURL(blob) });
      setCaption(text);
    } catch {
      toast({ title: "Image illisible", description: "Impossible de préparer cette image.", variant: "destructive" });
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setCaption("");
  };
  const sendImage = () => {
    if (!preview) return;
    upload.mutate(
      { data: { file: preview.blob, purpose: "image", conversationId } },
      {
        onSuccess: (file) =>
          sendData({ type: "image", fileId: file.id, content: caption.trim() || undefined }, () => {
            closePreview();
            setText("");
          }),
        onError: (e) => toast({ title: "Envoi de l'image impossible", description: errorMessage(e), variant: "destructive" }),
      },
    );
  };

  // ---------------- voice ----------------
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [vsend, setVsend] = useState<VoiceSend>({ status: "idle" });
  const [recErr, setRecErr] = useState<RecorderError | null>(null);
  const [mode, setMode] = useState<"hold" | "locked">("hold");
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const convRef = useRef(conversationId);
  convRef.current = conversationId;
  const recordingConversation = useRef(conversationId);
  const draftRef = useRef<VoiceDraft | null>(null);
  draftRef.current = draft;
  const sendAbort = useRef<AbortController | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const modeRef = useRef(mode);
  const sendWhenReady = useRef(false);
  modeRef.current = mode;

  const recorder = useVoiceRecorder(
    ({ blob, duration }) => {
      if (recordingConversation.current !== convRef.current) return;
      if (blob.size > MAX_VOICE_BYTES) {
        setRecErr({ title: "Note vocale trop lourde", description: "Le fichier dépasse 12 Mo. Enregistrez un message plus court." });
        return;
      }
      setRecErr(null);
      setVsend({ status: "idle" });
      setDraft({ conversationId: recordingConversation.current, blob, url: URL.createObjectURL(blob), duration, replyToId: replyTo?.id, clientMessageId: crypto.randomUUID() });
    },
    (e) => setRecErr(e),
  );
  const recRef = useRef(recorder);
  recRef.current = recorder;
  const recording = recorder.phase !== "idle";

  const discardDraft = () => {
    sendAbort.current?.abort();
    sendAbort.current = null;
    const d = draftRef.current;
    if (d) URL.revokeObjectURL(d.url);
    setDraft(null);
    setVsend({ status: "idle" });
  };

  // Conversation change or unmount: stop recording, abort requests, drop the draft.
  useEffect(() => {
    return () => {
      recRef.current.cancel();
      sendAbort.current?.abort();
      sendAbort.current = null;
      const d = draftRef.current;
      if (d) URL.revokeObjectURL(d.url);
      draftRef.current = null;
      setDraft(null);
      setVsend({ status: "idle" });
      setRecErr(null);
      gesture.current = null;
    };
  }, [conversationId]);

  const sendVoice = async () => {
    const d = draftRef.current;
    if (!d || sendAbort.current || vsend.status === "uploading" || vsend.status === "sending") return;
    if (d.conversationId !== convRef.current) {
      discardDraft();
      return;
    }
    const ctl = new AbortController();
    sendAbort.current = ctl;
    const alive = () => !ctl.signal.aborted && draftRef.current === d;
    let fileId = d.fileId;
    try {
      if (!fileId) {
        setVsend({ status: "uploading" });
        const f = await withDeadline(UPLOAD_DEADLINE, (signal) => uploadFile({ file: d.blob, purpose: "voice", conversationId: d.conversationId }, { signal }), ctl.signal);
        fileId = f.id;
        d.fileId = f.id; // keep for retry, even if the message step fails
      }
      if (!alive()) return;
      setVsend({ status: "sending" });
      const m = await withDeadline(
        SEND_DEADLINE,
        (signal) => sendRealtimeMessage(d.conversationId, { type: "voice", fileId, clientMessageId: d.clientMessageId, duration: Math.min(MAX_VOICE_SECONDS, d.duration), ...(d.replyToId ? { replyToId: d.replyToId } : {}) }, signal),
        ctl.signal,
      );
      if (!alive()) return;
      pushMessage(m);
      if (draftRef.current === d) {
        URL.revokeObjectURL(d.url);
        draftRef.current = null;
        setDraft(null);
        setVsend({ status: "idle" });
      }
    } catch (e) {
      if (!alive()) return;
      setVsend({ status: "error", error: errorMessage(e) });
    } finally {
      if (sendAbort.current === ctl) sendAbort.current = null;
    }
  };

  const beginRecording = async (m: "hold" | "locked") => {
    if (recording || draft || busy) return;
    sendWhenReady.current = false;
    setRecErr(null);
    modeRef.current = m;
    setMode(m);
    setDrag({ dx: 0, dy: 0 });
    recordingConversation.current = convRef.current;
    await recRef.current.start();
  };
  useEffect(() => {
    if (!draft || !sendWhenReady.current) return;
    sendWhenReady.current = false;
    void sendVoice();
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMicDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || recording || draft) return;
    e.preventDefault();
    try {
      // The mic itself changes position in the recording toolbar. Capture on
      // the persistent wrapper so that rerendering cannot lose the finger.
      e.currentTarget.closest<HTMLElement>("[data-voice-composer]")?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
    void beginRecording("hold");
  };
  const onMicMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || modeRef.current !== "hold") return;
    const dx = Math.min(0, e.clientX - g.x);
    const dy = Math.min(0, e.clientY - g.y);
    setDrag({ dx, dy });
    if (-dy > LOCK_DY) {
      modeRef.current = "locked";
      setMode("locked");
      gesture.current = null;
      navigator.vibrate?.(10);
    } else if (-dx > CANCEL_DX) {
      gesture.current = null;
      recRef.current.cancel();
      navigator.vibrate?.([10, 40, 10]);
    }
  };
  const onMicUp = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setDrag({ dx: 0, dy: 0 });
    if (modeRef.current === "locked") return;
    const r = recRef.current;
    // Short tap or release while permission prompt is pending: switch to hands-free instead of losing it.
    if (r.phase === "requesting" || Date.now() - g.t < 600) {
      modeRef.current = "locked";
      setMode("locked");
      return;
    }
    if (r.phase === "recording" || r.phase === "paused") r.stop(); // becomes a preview, never auto-sent
  };
  const onMicCancel = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setDrag({ dx: 0, dy: 0 });
    // The system interrupted the gesture: keep recording hands-free rather than discard.
    if (modeRef.current === "hold") {
      modeRef.current = "locked";
      setMode("locked");
    }
  };

  const hasText = text.trim().length > 0;
  const voiceBusy = vsend.status === "uploading" || vsend.status === "sending";
  const holding = recording && mode === "hold";
  const remaining = MAX_VOICE_SECONDS - recorder.elapsed;

  const micButton = (
    <button
      type="button"
      onPointerDown={onMicDown}
      onClick={(e) => {
        if (e.detail === 0) void beginRecording("locked"); // keyboard / assistive tap
      }}
      onContextMenu={(e) => e.preventDefault()}
      disabled={busy || !!draft}
      className={cn(
        "relative z-10 grid h-11 w-11 shrink-0 touch-none select-none place-items-center rounded-full transition-[transform,background-color] duration-150 [-webkit-touch-callout:none]",
        holding ? "scale-[1.35] bg-red-500 text-white shadow-lg" : "bg-muted text-foreground hover:bg-secondary active:scale-90 disabled:opacity-50",
      )}
      style={holding ? { transform: `translate(${drag.dx * 0.35}px, ${drag.dy * 0.35}px) scale(1.35)` } : undefined}
      aria-label="Maintenir pour enregistrer une note vocale, ou appuyer pour enregistrer mains libres"
      title="Maintenir pour enregistrer"
      data-testid="button-record"
    >
      {recorder.phase === "requesting" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
    </button>
  );

  return (
    <div data-voice-composer onPointerMove={onMicMove} onPointerUp={onMicUp} onPointerCancel={onMicCancel} onLostPointerCapture={onMicCancel} className="relative border-t bg-card/90 backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      {replyTo && <div className="mx-auto flex max-w-3xl items-center gap-3 border-l-4 border-primary bg-muted px-4 py-2" data-testid="reply-preview">
        <div className="min-w-0 flex-1 text-sm"><p className="font-semibold text-primary">{replyTo.senderName}</p><p className="truncate text-muted-foreground">{replyTo.content || (replyTo.type === "voice" ? "Message vocal" : "Photo")}</p></div>
        <button type="button" onClick={() => { if (draftRef.current) draftRef.current.replyToId = undefined; onClearReply?.(); }} className="p-2" aria-label="Annuler la réponse"><X className="h-5 w-5" /></button>
      </div>}
      {recording && mode === "locked" && <div className="mx-auto max-w-3xl space-y-5 px-4 py-5" data-testid="panel-locked-recording">
        <div className="flex items-center justify-between gap-5">
          <span className="font-mono-num text-3xl" data-testid="text-recording-time">{recorder.phase === "requesting" ? "Micro…" : formatDuration(recorder.elapsed)}</span>
          <div className="flex h-8 items-center gap-1" aria-label={recorder.phase === "paused" ? "En pause" : "Enregistrement en cours"}>
            {Array.from({ length: 21 }, (_, i) => <span key={i} className={cn("w-1 rounded-full bg-primary/60", recorder.phase === "recording" && "animate-pulse")} style={{ height: `${5 + ((i * 13) % 23)}px`, animationDelay: `${i * 60}ms` }} />)}
          </div>
          <Lock className="h-5 w-5 shrink-0 text-primary" aria-label="Mains libres" />
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => { sendWhenReady.current = false; recorder.cancel(); }} className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive" aria-label="Annuler l’enregistrement" data-testid="button-cancel-recording"><Trash2 className="h-6 w-6" /></button>
          {recorder.canPause && recorder.phase !== "requesting" ? <button type="button" onClick={() => recorder.phase === "paused" ? recorder.resume() : recorder.pause()} className="flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-muted px-3 text-base font-semibold" data-testid={recorder.phase === "paused" ? "button-resume-recording" : "button-pause-recording"}>{recorder.phase === "paused" ? <Mic className="h-5 w-5" /> : <Pause className="h-5 w-5" />}{recorder.phase === "paused" ? "Continuer" : "Pause"}</button> : <span className="flex-1 text-center text-sm text-muted-foreground">Mains libres</span>}
          <button type="button" disabled={recorder.phase === "requesting"} onClick={() => { sendWhenReady.current = true; recorder.stop(); }} className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-out text-white disabled:opacity-50" aria-label="Envoyer le message vocal" data-testid="button-send-recording"><Send className="h-6 w-6" /></button>
        </div>
        <button type="button" disabled={recorder.phase === "requesting"} onClick={() => recorder.stop()} className="mx-auto flex items-center gap-2 text-xs text-muted-foreground" data-testid="button-stop-recording"><Square className="h-3 w-3" />Terminer et écouter avant d’envoyer</button>
      </div>}
      {preview && (
        <div className="absolute inset-x-0 bottom-full border-t bg-card p-3 shadow-[0_-12px_30px_-18px_rgba(11,27,63,0.4)] animate-in slide-in-from-bottom-4 duration-200" data-testid="panel-image-preview">
          <div className="mx-auto flex max-w-3xl gap-3">
            <img src={preview.url} alt="Aperçu" className="h-28 w-28 shrink-0 rounded-xl object-cover" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Aperçu · {(preview.blob.size / 1024).toFixed(0)} Ko compressé
                </span>
                <button onClick={closePreview} className="rounded-full p-1 text-muted-foreground hover:bg-muted" aria-label="Annuler" data-testid="button-cancel-image">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendImage()}
                placeholder="Ajouter une légende"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                data-testid="input-caption"
              />
              <button
                onClick={sendImage}
                disabled={busy}
                className="self-end rounded-full bg-out px-4 py-1.5 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-60"
                data-testid="button-send-image"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Envoyer l'image"}
              </button>
            </div>
          </div>
        </div>
      )}

      {recErr && !recording && (
        <div className="mx-auto flex max-w-3xl items-start gap-2 px-3 pt-2 text-sm" role="alert" data-testid="status-voice-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{recErr.title}.</span> <span className="text-muted-foreground">{recErr.description}</span>
          </div>
          <button onClick={() => setRecErr(null)} className="rounded-full p-1 text-muted-foreground hover:bg-muted" aria-label="Fermer le message" data-testid="button-dismiss-voice-error">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Lock rail shown while holding */}
      {holding && (
        <div className="pointer-events-none absolute bottom-full right-2 mb-2 flex flex-col items-center sm:right-4" style={{ right: "max(0.5rem, env(safe-area-inset-right))" }}>
          <button
            type="button"
            onClick={() => {
              modeRef.current = "locked";
              setMode("locked");
            }}
            className="pointer-events-auto flex flex-col items-center gap-1 rounded-full border bg-card px-2.5 pb-3 pt-2.5 text-muted-foreground shadow-lg animate-in slide-in-from-bottom-2 fade-in duration-200"
            style={{ transform: `translateY(${Math.max(drag.dy, -LOCK_DY) * 0.4}px)` }}
            aria-label="Verrouiller l'enregistrement mains libres"
            data-testid="button-lock-recording"
          >
            <Lock className={cn("h-4 w-4 transition-colors", -drag.dy > LOCK_DY * 0.6 && "text-primary")} />
            <ChevronUp className="h-4 w-4 animate-bounce" />
          </button>
        </div>
      )}

      <div className={cn("mx-auto max-w-3xl items-end gap-2 px-2 py-2 sm:px-4", recording && mode === "locked" ? "hidden" : "flex")}>
        {draft ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5" data-testid="panel-voice-preview">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={discardDraft}
                disabled={vsend.status === "sending"}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-destructive transition hover:bg-destructive/10 active:scale-90 disabled:opacity-40"
                aria-label="Supprimer la note vocale"
                data-testid="button-discard-voice"
              >
                <Trash2 className="h-5 w-5" />
              </button>
              <VoiceDraftPlayer url={draft.url} duration={draft.duration} />
              <button
                type="button"
                onClick={() => void sendVoice()}
                disabled={voiceBusy}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-out px-3.5 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_#1E5EFF] transition active:scale-95 disabled:opacity-70"
                data-testid="button-send-voice"
              >
                {voiceBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : vsend.status === "error" ? <RotateCw className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                <span className="hidden min-[360px]:inline">{vsend.status === "error" ? "Réessayer" : "Envoyer"}</span>
              </button>
            </div>
            <div className="px-2 text-xs" aria-live="polite" data-testid="status-voice-send">
              {vsend.status === "uploading" && <span className="text-muted-foreground">Téléversement de la note vocale…</span>}
              {vsend.status === "sending" && <span className="text-muted-foreground">Envoi du message…</span>}
              {vsend.status === "error" && (
                <span className="text-destructive">
                  Note vocale non envoyée{draft.fileId ? " (fichier déjà téléversé)" : ""} : {vsend.error}. Elle est conservée, touchez Réessayer.
                </span>
              )}
              {vsend.status === "idle" && <span className="text-muted-foreground">Écoutez puis touchez Envoyer. Rien n'est envoyé sans votre accord.</span>}
            </div>
          </div>
        ) : recording ? (
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted pl-1.5 pr-3" data-testid="status-recording">
            {mode === "locked" ? (
              <button
                type="button"
                onClick={() => recorder.cancel()}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-destructive hover:bg-destructive/10"
                aria-label="Annuler l'enregistrement"
                data-testid="button-cancel-recording"
              >
                <Trash2 className="h-4.5 w-4.5" />
              </button>
            ) : (
              <span className="w-1.5" />
            )}
            <span className="relative grid h-3 w-3 shrink-0 place-items-center">
              {recorder.phase === "recording" && <span className="absolute h-3 w-3 rounded-full bg-red-500 rec-pulse" />}
              <span className={cn("h-2.5 w-2.5 rounded-full", recorder.phase === "paused" ? "bg-amber-500" : "bg-red-500")} />
            </span>
            <span className="font-mono-num text-sm font-medium" data-testid="text-recording-time">
              {recorder.phase === "requesting" ? "Micro…" : formatDuration(recorder.elapsed)}
            </span>
            {remaining <= 30 && recorder.phase !== "requesting" ? (
              <span className="font-mono-num text-xs text-destructive">-{formatDuration(Math.max(0, remaining))}</span>
            ) : (
              <span className="hidden font-mono-num text-xs text-muted-foreground min-[380px]:inline">/ 5:00</span>
            )}
            {mode === "hold" ? (
              <span
                className="ml-auto flex min-w-0 items-center gap-0.5 truncate text-xs text-muted-foreground"
                style={{ transform: `translateX(${drag.dx * 0.5}px)`, opacity: 1 - Math.min(0.7, -drag.dx / CANCEL_DX) }}
              >
                <ChevronLeft className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Glisser pour annuler</span>
              </span>
            ) : (
              <span className="ml-auto truncate text-xs text-muted-foreground">{recorder.phase === "paused" ? "En pause" : "Mains libres"}</span>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={preparing || busy}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-90"
              aria-label="Joindre une image"
              data-testid="button-attach-image"
            >
              {preparing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} data-testid="input-image-file" />
            <textarea
              ref={taRef}
              value={text}
              rows={1}
              onChange={(e) => onText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submitText();
                }
              }}
              onBlur={stopTyping}
              maxLength={10000}
              placeholder="Écrire un message"
              className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border bg-background px-4 py-2.5 text-[15px] leading-6 outline-none transition-colors focus:border-primary/60"
              data-testid="input-message"
            />
          </>
        )}

        {draft ? null : recording && mode === "locked" ? (
          <>
            {recorder.canPause && recorder.phase !== "requesting" && (
              <button
                type="button"
                onClick={() => (recorder.phase === "paused" ? recorder.resume() : recorder.pause())}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-foreground transition active:scale-90"
                aria-label={recorder.phase === "paused" ? "Reprendre l'enregistrement" : "Mettre en pause"}
                data-testid={recorder.phase === "paused" ? "button-resume-recording" : "button-pause-recording"}
              >
                {recorder.phase === "paused" ? <Mic className="h-5 w-5 text-red-500" /> : <Pause className="h-5 w-5 fill-current" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => recorder.stop()}
              disabled={recorder.phase === "requesting"}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-500 text-white shadow-md transition active:scale-90 disabled:opacity-60"
              aria-label="Terminer et écouter"
              data-testid="button-stop-recording"
            >
              {recorder.phase === "requesting" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Square className="h-4 w-4 fill-current" />}
            </button>
          </>
        ) : hasText && !recording ? (
          <button
            type="button"
            onClick={submitText}
            disabled={busy}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-out text-white shadow-[0_6px_16px_-6px_#1E5EFF] transition active:scale-90 disabled:opacity-60 animate-in zoom-in-75 duration-150"
            aria-label="Envoyer"
            data-testid="button-send"
          >
            {send.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" strokeWidth={2.5} />}
          </button>
        ) : (
          micButton
        )}
      </div>
      <span className="sr-only" aria-live="assertive">
        {recorder.phase === "recording" ? "Enregistrement en cours" : recorder.phase === "paused" ? "Enregistrement en pause" : ""}
      </span>
    </div>
  );
}
