import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Loader2, Mic, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMessagesQueryKey,
  getGetSummaryQueryKey,
  useSendMessage,
  useUploadFile,
  type Message,
  type MessageInput,
} from "@workspace/api-client-react";
import { compressImage, formatDuration } from "@/lib/chat-utils";
import { errorMessage } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useRealtime } from "@/components/realtime";
import { cn } from "@/lib/utils";

const MAX_REC = 300;

export function Composer({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { emitTyping } = useRealtime();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [rec, setRec] = useState<{ seconds: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingOn = useRef(false);

  const send = useSendMessage();
  const upload = useUploadFile();
  const busy = send.isPending || upload.isPending;

  const pushMessage = (m: Message) => {
    qc.setQueryData<Message[]>(getGetMessagesQueryKey(conversationId), (old) =>
      old ? (old.some((x) => x.id === m.id) ? old : [...old, m]) : [m],
    );
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/conversations" });
    void qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
  };
  const sendData = (data: MessageInput, onDone?: () => void) =>
    send.mutate(
      { id: conversationId, data },
      {
        onSuccess: (m) => {
          pushMessage(m);
          onDone?.();
        },
        onError: (e) => toast({ title: "Message non envoyé", description: errorMessage(e), variant: "destructive" }),
      },
    );

  const stopTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (typingOn.current) emitTyping(conversationId, false);
    typingOn.current = false;
  };
  useEffect(() => () => stopTyping(), [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onText = (v: string) => {
    setText(v);
    if (!typingOn.current && v.trim()) {
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

  // ---- voice ----
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const intent = useRef<"idle" | "pending" | "recording">("idle");
  const cancelled = useRef(false);
  const released = useRef(false);

  const cleanupRec = () => {
    if (tick.current) clearInterval(tick.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    intent.current = "idle";
    setRec(null);
  };

  const startRec = async () => {
    if (intent.current !== "idle" || busy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast({ title: "Enregistrement indisponible", description: "Votre navigateur ne permet pas l'enregistrement audio.", variant: "destructive" });
      return;
    }
    intent.current = "pending";
    cancelled.current = false;
    released.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (released.current) {
        stream.getTracks().forEach((t) => t.stop());
        intent.current = "idle";
        toast({ title: "Maintenez le bouton", description: "Gardez le doigt appuyé pendant que vous parlez." });
        return;
      }
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = () => {
        const seconds = Math.min(MAX_REC, Math.round((Date.now() - startedAt.current) / 1000));
        const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
        const skip = cancelled.current;
        cleanupRec();
        if (skip) return;
        if (seconds < 1 || blob.size < 800) {
          toast({ title: "Message trop court", description: "Maintenez pour enregistrer." });
          return;
        }
        upload.mutate(
          { data: { file: blob, purpose: "voice", conversationId } },
          {
            onSuccess: (f) => sendData({ type: "voice", fileId: f.id, duration: seconds }),
            onError: (e) => toast({ title: "Note vocale non envoyée", description: errorMessage(e), variant: "destructive" }),
          },
        );
      };
      recorder.current = mr;
      startedAt.current = Date.now();
      mr.start(250);
      intent.current = "recording";
      setRec({ seconds: 0 });
      navigator.vibrate?.(15);
      tick.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt.current) / 1000);
        setRec({ seconds: s });
        if (s >= MAX_REC) stopRec(false);
      }, 250);
    } catch (e) {
      intent.current = "idle";
      const n = (e as DOMException).name;
      toast({
        title: "Micro inaccessible",
        description:
          n === "NotAllowedError" || n === "SecurityError"
            ? "Autorisez l'accès au micro dans les réglages du navigateur, puis réessayez."
            : n === "NotFoundError"
              ? "Aucun micro détecté sur cet appareil."
              : "Le micro est occupé ou indisponible.",
        variant: "destructive",
      });
    }
  };
  const stopRec = (cancel: boolean) => {
    released.current = true;
    if (intent.current !== "recording") return;
    cancelled.current = cancel;
    if (recorder.current?.state === "recording") recorder.current.stop();
  };
  useEffect(() => () => {
    cancelled.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const hasText = text.trim().length > 0;

  return (
    <div className="relative border-t bg-card/90 backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {preview && (
        <div className="absolute inset-x-0 bottom-full border-t bg-card p-3 shadow-[0_-12px_30px_-18px_rgba(11,27,63,0.4)] animate-in slide-in-from-bottom-4 duration-200" data-testid="panel-image-preview">
          <div className="mx-auto flex max-w-3xl gap-3">
            <img src={preview.url} alt="Aperçu" className="h-28 w-28 shrink-0 rounded-xl object-cover" />
            <div className="flex flex-1 flex-col gap-2">
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
      <div className="mx-auto flex max-w-3xl items-end gap-2 px-2 py-2 sm:px-4">
        {rec ? (
          <div className="flex h-11 flex-1 items-center gap-3 rounded-full bg-muted px-4" data-testid="status-recording">
            <span className="relative grid h-3 w-3 place-items-center">
              <span className="absolute h-3 w-3 rounded-full bg-red-500 rec-pulse" />
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            <span className="font-mono-num text-sm font-medium">{formatDuration(rec.seconds)}</span>
            <span className="font-mono-num text-xs text-muted-foreground">/ 5:00</span>
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Trash2 className="h-3.5 w-3.5" /> Glissez hors du bouton pour annuler
            </span>
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
              className="max-h-40 min-h-11 flex-1 resize-none rounded-[22px] border bg-background px-4 py-2.5 text-[15px] leading-6 outline-none transition-colors focus:border-primary/60"
              data-testid="input-message"
            />
          </>
        )}
        {hasText && !rec ? (
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
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              void startRec();
            }}
            onPointerUp={() => stopRec(false)}
            onPointerLeave={() => stopRec(true)}
            onPointerCancel={() => stopRec(true)}
            onContextMenu={(e) => e.preventDefault()}
            disabled={busy && !rec}
            className={cn(
              "relative grid h-11 w-11 shrink-0 touch-none select-none place-items-center rounded-full transition-all",
              rec ? "scale-125 bg-red-500 text-white" : "bg-muted text-foreground hover:bg-secondary active:scale-90",
            )}
            aria-label="Maintenir pour enregistrer"
            title="Maintenir pour enregistrer"
            data-testid="button-record"
          >
            {upload.isPending && !preview ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
          </button>
        )}
      </div>
    </div>
  );
}
