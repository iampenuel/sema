"use client";
/* eslint-disable @next/next/no-img-element -- reviewed photos use ephemeral blob URLs that must not enter Next image optimization */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Camera, Check, RotateCcw, ShieldAlert, Trash2, X } from "lucide-react";
import { initialPhotoCaptureState, photoCaptureReducer } from "@/lib/photo/captureMachine";
import { PHOTO_PRIVACY_CONFIG } from "@/lib/photo/config";
import { canCapturePhoto } from "@/lib/photo/privacyPolicy";
import { clearCanvas, sanitizePhotoCapture } from "@/lib/photo/sanitize";
import type { EphemeralPhotoDraft, PhotoObservationMetadata, PhotoPrivacyProvider } from "@/lib/photo/types";
import { createProductionPhotoPrivacyProvider } from "@/lib/photo/workerProvider";

const bodyRegions = ["Right wrist / hand", "Left wrist / hand", "Right arm", "Left arm", "Right leg", "Left leg", "Chest / breathing", "Skin area", "Other"];
const neutralTags = ["Appearance", "Movement", "Change over time", "Size reference"];

type Props = {
  onApprove: (draft: EphemeralPhotoDraft, metadata: PhotoObservationMetadata) => void;
  onClose: () => void;
  providerFactory?: () => PhotoPrivacyProvider;
};

export function PhotoCapturePanel({ onApprove, onClose, providerFactory = createProductionPhotoPrivacyProvider }: Props) {
  const [state, dispatch] = useReducer(photoCaptureReducer, initialPhotoCaptureState);
  const [note, setNote] = useState("");
  const [bodyLocation, setBodyLocation] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [includeInPacket, setIncludeInPacket] = useState(false);
  const [developmentSimulation, setDevelopmentSimulation] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const providerRef = useRef<PhotoPrivacyProvider | null>(null);
  const samplingRef = useRef<number | null>(null);
  const inferenceRef = useRef(false);
  const visibilityEpochRef = useRef(0);
  const mountedRef = useRef(true);

  const stopStream = useCallback(() => {
    if (samplingRef.current !== null) window.clearInterval(samplingRef.current);
    samplingRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    dispatch({ type: "STREAM_STOPPED" });
  }, []);

  const disposeProvider = useCallback(() => {
    void providerRef.current?.dispose();
    providerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    dispatch({ type: "OPEN" });
    const onVisibility = () => {
      const visible = !document.hidden;
      visibilityEpochRef.current += 1;
      inferenceRef.current = false;
      dispatch({ type: "VISIBILITY", visible });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      stopStream();
      disposeProvider();
    };
  }, [disposeProvider, stopStream]);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: "CAMERA_UNAVAILABLE" });
      return;
    }
    dispatch({ type: "REQUEST_PERMISSION" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        stopStream();
        dispatch({ type: "CAMERA_UNAVAILABLE" });
      }, { once: true });
      dispatch({ type: "PERMISSION_GRANTED" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!videoRef.current) throw new Error("camera_preview_unavailable");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      dispatch({ type: "MODEL_LOADING" });
      disposeProvider();
      const provider = providerFactory();
      providerRef.current = provider;
      setDevelopmentSimulation(provider.isDevelopmentSimulation === true);
      await provider.load();
      if (!mountedRef.current) return;
      dispatch({ type: "MODEL_READY" });
    } catch (error) {
      stopStream();
      disposeProvider();
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) dispatch({ type: "PERMISSION_DENIED" });
      else if (error instanceof DOMException && ["NotFoundError", "NotReadableError", "OverconstrainedError"].includes(error.name)) dispatch({ type: "CAMERA_UNAVAILABLE" });
      else dispatch({ type: "MODEL_ERROR" });
    }
  }

  const samplePreview = useCallback(async () => {
    const video = videoRef.current;
    const provider = providerRef.current;
    if (!video || !provider || inferenceRef.current || document.hidden || video.readyState < 2 || !streamRef.current?.active) return;
    inferenceRef.current = true;
    const visibilityEpoch = visibilityEpochRef.current;
    dispatch({ type: "INFERENCE_STARTED" });
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_PRIVACY_CONFIG.previewLongEdge;
    canvas.height = PHOTO_PRIVACY_CONFIG.previewLongEdge;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    try {
      if (!context) throw new Error("canvas_unavailable");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = await provider.evaluate(canvas);
      if (mountedRef.current && !document.hidden && visibilityEpoch === visibilityEpochRef.current) dispatch({ type: "PREVIEW_RESULT", result });
    } catch {
      if (mountedRef.current) dispatch({ type: "MODEL_ERROR" });
    } finally {
      inferenceRef.current = false;
      clearCanvas(canvas);
    }
  }, []);

  useEffect(() => {
    if (!state.modelReady || !state.streamActive || !state.pageVisible) return;
    void samplePreview();
    samplingRef.current = window.setInterval(() => void samplePreview(), PHOTO_PRIVACY_CONFIG.sampleIntervalMs);
    return () => {
      if (samplingRef.current !== null) window.clearInterval(samplingRef.current);
      samplingRef.current = null;
    };
  }, [samplePreview, state.modelReady, state.pageVisible, state.streamActive]);

  useEffect(() => {
    const latest = state.latestResult;
    if (!latest || latest.decision !== "allowed") return;
    const timeout = window.setTimeout(() => dispatch({
      type: "PREVIEW_RESULT",
      result: { ...latest, decision: "uncertain", reasonCode: "result_stale", evaluatedAt: Date.now() }
    }), PHOTO_PRIVACY_CONFIG.resultFreshnessMs + 1);
    return () => window.clearTimeout(timeout);
  }, [state.latestResult]);

  const captureAllowed = useMemo(() => canCapturePhoto(
    { allowedStreak: state.allowedStreak, latest: state.latestResult },
    state.latestResult?.evaluatedAt ?? 0,
    { modelReady: state.modelReady, permissionGranted: state.permissionGranted, streamActive: state.streamActive, inferenceRunning: state.inferenceRunning, pageVisible: state.pageVisible, captureProcessing: state.captureProcessing }
  ), [state]);

  async function capture() {
    const video = videoRef.current;
    const provider = providerRef.current;
    if (!captureAllowed || !video || !provider) return;
    dispatch({ type: "CAPTURE_STARTED" });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    try {
      if (!context || !canvas.width || !canvas.height) throw new Error("frame_invalid");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = await provider.evaluate(canvas);
      if (result.decision !== "allowed" || result.reasonCode !== "clear") {
        dispatch({ type: "CAPTURE_REJECTED", result });
        return;
      }
      const sanitized = await sanitizePhotoCapture(canvas, canvas.width, canvas.height);
      const id = `photo-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const objectUrl = URL.createObjectURL(sanitized.blob);
      const draft: EphemeralPhotoDraft = {
        id,
        createdAt: new Date().toISOString(),
        ...sanitized,
        note: "",
        tags: [],
        includeInPacket: false,
        source: "patient_camera_capture",
        privacyGuardStatus: "allowed_on_device",
        availability: "current_tab_only",
        blob: sanitized.blob,
        objectUrl,
        privacyDecision: "allowed",
        privacyModelVersion: result.modelVersion,
        status: "needs_review"
      };
      stopStream();
      disposeProvider();
      dispatch({ type: "REVIEW_READY", draft });
    } catch {
      dispatch({ type: "MODEL_ERROR" });
    } finally {
      clearCanvas(canvas);
    }
  }

  function discardDraft(close = false) {
    if (state.draft) URL.revokeObjectURL(state.draft.objectUrl);
    stopStream();
    disposeProvider();
    dispatch({ type: "DISCARDED" });
    if (close) onClose();
  }

  function approve() {
    if (!state.draft) return;
    dispatch({ type: "SAVE_STARTED" });
    const approved: EphemeralPhotoDraft = { ...state.draft, note: note.trim(), bodyLocation: bodyLocation || undefined, tags, includeInPacket, status: "approved" };
    const metadata: PhotoObservationMetadata = {
      id: approved.id,
      createdAt: approved.createdAt,
      width: approved.width,
      height: approved.height,
      mimeType: approved.mimeType,
      sizeBytes: approved.sizeBytes,
      note: approved.note,
      bodyLocation: approved.bodyLocation,
      tags: approved.tags,
      includeInPacket: approved.includeInPacket,
      source: approved.source,
      privacyGuardStatus: approved.privacyGuardStatus,
      availability: approved.availability
    };
    onApprove(approved, metadata);
    dispatch({ type: "SAVED" });
    onClose();
  }

  const blocked = state.status === "preview_blocked" || state.status === "preview_uncertain";
  const unavailable = state.status === "error";
  const privacyLabel = unavailable ? "Privacy check unavailable" : blocked ? "Camera paused for privacy" : state.status === "preview_allowed" ? "Ready to capture" : "Privacy check in progress";

  return (
    <section className="mt-5 rounded-lg border border-sema-border bg-[#f8fbfd] p-4 sm:p-5" aria-labelledby="photo-capture-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-sema-blue">ON-DEVICE PRIVACY CHECK</p>
          <h3 id="photo-capture-title" className="mt-1 text-xl font-bold text-ink">Take a photo</h3>
        </div>
        <button type="button" onClick={() => discardDraft(true)} className="min-h-11 rounded-md px-3 text-sm font-semibold text-sema-slate hover:bg-white" aria-label="Close photo capture"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      <p aria-live="polite" className="sr-only">{state.announcement}</p>
      {developmentSimulation && <p className="mt-3 rounded-md border border-[#e3c6a0] bg-[#fff8ec] p-3 text-xs font-bold text-[#7b5a20]">Development simulation only · Not real privacy protection</p>}

      {state.status === "consent_required" || state.status === "idle" ? (
        <div className="mt-4 rounded-md border border-[#c5dbe9] bg-white p-4">
          <p className="text-sm leading-6 text-sema-slate">Sema checks camera frames on this device to help prevent private images from being captured. This safeguard may make mistakes. Camera frames are not uploaded for this privacy check.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={startCamera} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white"><Camera className="h-4 w-4" aria-hidden="true" />Allow camera</button>
            <button type="button" onClick={() => discardDraft(true)} className="min-h-11 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-sema-slate">Continue without a photo</button>
          </div>
        </div>
      ) : state.status === "permission_denied" || state.status === "camera_unavailable" ? (
        <FallbackMessage message="Camera capture is unavailable. You can continue with text or the body map." />
      ) : state.status === "reviewing" && state.draft ? (
        <div className="mt-4">
          <p className="rounded-md border border-sema-border bg-white p-3 text-sm text-sema-slate">Review this photo before adding it. Sema does not analyze photos for disease or diagnosis.</p>
          {/* object URLs remain current-tab memory only */}
          <img src={state.draft.objectUrl} alt="Photo awaiting your review" className="mt-4 max-h-[28rem] w-full rounded-md border border-sema-border bg-black object-contain" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="text-sm font-semibold text-ink">Neutral note, optional</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="mt-1 min-h-20 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm" placeholder="Describe only what you noticed." /></label>
            <label><span className="text-sm font-semibold text-ink">Body location, optional</span><select value={bodyLocation} onChange={(event) => setBodyLocation(event.target.value)} className="mt-1 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm"><option value="">Not selected</option>{bodyRegions.map((region) => <option key={region}>{region}</option>)}</select></label>
            <fieldset><legend className="text-sm font-semibold text-ink">Neutral tags, optional</legend><div className="mt-1 flex flex-wrap gap-2">{neutralTags.map((tag) => <label key={tag} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-sema-border bg-white px-3 text-xs"><input type="checkbox" checked={tags.includes(tag)} onChange={(event) => setTags((current) => event.target.checked ? [...current, tag] : current.filter((item) => item !== tag))} />{tag}</label>)}</div></fieldset>
          </div>
          <label className="mt-4 flex min-h-11 items-center gap-3 rounded-md border border-sema-border bg-white p-3 text-sm"><input type="checkbox" checked={includeInPacket} onChange={(event) => setIncludeInPacket(event.target.checked)} />Include in current evidence packet</label>
          <p className="mt-2 text-xs font-semibold text-sema-blue">Photo available in this tab only</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={approve} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white"><Check className="h-4 w-4" aria-hidden="true" />I reviewed this photo and want to add it to this Sema session.</button>
            <button type="button" onClick={() => { discardDraft(); dispatch({ type: "RESET_PREVIEW" }); }} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold"><RotateCcw className="h-4 w-4" aria-hidden="true" />Retake</button>
            <button type="button" onClick={() => discardDraft(true)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#d6a9a9] bg-white px-4 py-2 text-sm font-semibold text-[#9b4141]"><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="relative overflow-hidden rounded-md bg-black">
            <video ref={videoRef} muted playsInline className={`aspect-video w-full object-cover transition ${state.status === "preview_allowed" ? "" : "blur-xl scale-110 opacity-40"}`} />
            {state.status !== "preview_allowed" && <div className="absolute inset-0 flex items-center justify-center bg-ink/65 p-5 text-center text-sm font-semibold text-white"><ShieldAlert className="mr-2 h-5 w-5" aria-hidden="true" />{privacyLabel}</div>}
          </div>
          <p className="mt-3 text-sm font-semibold text-sema-blue" aria-live="polite">{privacyLabel}</p>
          {blocked && <FallbackMessage message="Camera paused for privacy. Sema cannot capture images that may include an intimate area in this public demo. You can describe what you noticed using text or the body map. Concerns involving an intimate area should be discussed directly with a licensed clinician." />}
          {unavailable && <FallbackMessage message="The on-device privacy check is unavailable, so photo capture has been disabled. You can continue with text or the body map." />}
          <button type="button" onClick={capture} disabled={!captureAllowed} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-md bg-sema-blue px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-sema-slate/40"><Camera className="h-4 w-4" aria-hidden="true" />Capture</button>
        </div>
      )}
    </section>
  );
}

function FallbackMessage({ message }: { message: string }) {
  return <p className="mt-4 rounded-md border border-[#e3c6a0] bg-[#fff8ec] p-4 text-sm leading-6 text-sema-slate">{message}</p>;
}
