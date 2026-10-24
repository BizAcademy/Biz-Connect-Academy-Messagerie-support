import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_VOICE_SECONDS = 300;
export const MAX_VOICE_BYTES = 12 * 1024 * 1024;

export type RecorderPhase = "idle" | "requesting" | "recording" | "paused";
export type VoiceResult = { blob: Blob; duration: number; mime: string };
export type RecorderError = { title: string; description: string };

const MIMES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];

function micError(e: unknown): RecorderError {
  const n = (e as DOMException)?.name;
  if (n === "NotAllowedError" || n === "SecurityError")
    return { title: "Accès au micro refusé", description: "Autorisez le micro dans les réglages du navigateur, puis réessayez." };
  if (n === "NotFoundError") return { title: "Aucun micro détecté", description: "Branchez ou activez un micro sur cet appareil." };
  return { title: "Micro indisponible", description: "Le micro est occupé par une autre application. Réessayez." };
}

/**
 * Voice recorder with pause/resume, active-time limit and strict cleanup.
 * Every async callback is tied to a session token; stale callbacks are ignored.
 */
export function useVoiceRecorder(onResult: (r: VoiceResult) => void, onError: (e: RecorderError) => void) {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const token = useRef(0);
  const mr = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const accum = useRef(0);
  const segStart = useRef<number | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const permissionWait = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discard = useRef(false);
  const requesting = useRef(false);
  const resultRef = useRef(onResult);
  const errorRef = useRef(onError);
  resultRef.current = onResult;
  errorRef.current = onError;

  const active = () => accum.current + (segStart.current ? Date.now() - segStart.current : 0);

  const release = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    if (permissionWait.current) clearTimeout(permissionWait.current);
    permissionWait.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    mr.current = null;
    segStart.current = null;
    requesting.current = false;
  }, []);

  const stop = useCallback(() => {
    const r = mr.current;
    if (!r || r.state === "inactive") return;
    if (segStart.current) {
      accum.current += Date.now() - segStart.current;
      segStart.current = null;
    }
    discard.current = false;
    try {
      r.stop();
    } catch {
      release();
      setPhase("idle");
    }
  }, [release]);

  const cancel = useCallback(() => {
    token.current++;
    discard.current = true;
    const r = mr.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
    release();
    setPhase("idle");
    setElapsed(0);
  }, [release]);

  const start = useCallback(async (): Promise<boolean> => {
    if (requesting.current || mr.current || phase !== "idle") return false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      errorRef.current({ title: "Enregistrement indisponible", description: "Ce navigateur ne permet pas l'enregistrement audio." });
      return false;
    }
    const my = ++token.current;
    requesting.current = true;
    setPhase("requesting");
    const permissionTimer = setTimeout(() => {
      if (my !== token.current) return;
      token.current++;
      requesting.current = false;
      permissionWait.current = null;
      setPhase("idle");
      errorRef.current({ title: "Autorisation du micro en attente", description: "La demande a pris trop de temps. Autorisez le micro puis réessayez." });
    }, 30000);
    permissionWait.current = permissionTimer;
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (e) {
      if (my === token.current) {
        requesting.current = false;
        setPhase("idle");
        errorRef.current(micError(e));
      }
      return false;
    } finally {
      clearTimeout(permissionTimer);
      if (permissionWait.current === permissionTimer) permissionWait.current = null;
    }
    if (my !== token.current) {
      s.getTracks().forEach((t) => t.stop());
      return false;
    }
    requesting.current = false;
    const mime = MIMES.find((m) => MediaRecorder.isTypeSupported?.(m));
    let r: MediaRecorder;
    try {
      try { r = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24000 }); }
      catch { r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined); }
    } catch {
      s.getTracks().forEach((t) => t.stop());
      setPhase("idle");
      errorRef.current({ title: "Enregistrement impossible", description: "Format audio non pris en charge par ce navigateur." });
      return false;
    }
    stream.current = s;
    mr.current = r;
    chunks.current = [];
    accum.current = 0;
    discard.current = false;
    r.ondataavailable = (e) => {
      if (my === token.current && e.data.size) chunks.current.push(e.data);
    };
    r.onstop = () => {
      if (my !== token.current) return;
      if (segStart.current) accum.current += Date.now() - segStart.current;
      segStart.current = null;
      const skip = discard.current;
      const type = r.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks.current, { type: type.split(";")[0] });
      const duration = Math.min(MAX_VOICE_SECONDS, Math.max(0, Math.round(accum.current / 1000)));
      chunks.current = [];
      release();
      setPhase("idle");
      setElapsed(0);
      if (skip) return;
      if (blob.size < 500 || accum.current < 700) {
        errorRef.current({ title: "Message trop court", description: "Parlez au moins une seconde avant de terminer." });
        return;
      }
      resultRef.current({ blob, duration: Math.max(1, duration), mime: blob.type });
    };
    r.onerror = () => {
      if (my !== token.current) return;
      errorRef.current({ title: "Enregistrement interrompu", description: "Le navigateur a interrompu le micro. Écoutez l’aperçu avant d’envoyer, ou réenregistrez votre message." });
      stop();
    };
    try { r.start(250); }
    catch {
      release();
      setPhase("idle");
      errorRef.current({ title: "Enregistrement impossible", description: "Le micro n’a pas pu démarrer. Fermez les applications qui l’utilisent et réessayez." });
      return false;
    }
    segStart.current = Date.now();
    setElapsed(0);
    setPhase("recording");
    s.getAudioTracks().forEach((track) => {
      track.onended = () => { if (my === token.current) stop(); };
    });
    navigator.vibrate?.(15);
    tick.current = setInterval(() => {
      if (my !== token.current) return;
      const ms = active();
      setElapsed(Math.floor(ms / 1000));
      if (ms >= MAX_VOICE_SECONDS * 1000) stop();
    }, 200);
    return true;
  }, [phase, release, stop]);

  const pause = useCallback(() => {
    const r = mr.current;
    if (!r || r.state !== "recording" || typeof r.pause !== "function") return;
    try { r.pause(); }
    catch {
      errorRef.current({ title: "Pause indisponible", description: "Ce navigateur n’a pas pu mettre le micro en pause. L’enregistrement continue ; vous pouvez le terminer et l’écouter." });
      return;
    }
    if (segStart.current) accum.current += Date.now() - segStart.current;
    segStart.current = null;
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    const r = mr.current;
    if (!r || r.state !== "paused") return;
    try { r.resume(); }
    catch {
      errorRef.current({ title: "Reprise impossible", description: "Terminez ce vocal pour écouter et envoyer la partie déjà enregistrée." });
      return;
    }
    segStart.current = Date.now();
    setPhase("recording");
  }, []);

  useEffect(() => () => {
    token.current++;
    discard.current = true;
    try {
      if (mr.current && mr.current.state !== "inactive") mr.current.stop();
    } catch {
      /* ignore */
    }
    if (tick.current) clearInterval(tick.current);
    if (permissionWait.current) clearTimeout(permissionWait.current);
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const canPause = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.prototype?.pause === "function";

  return { phase, elapsed, start, stop, cancel, pause, resume, canPause };
}
