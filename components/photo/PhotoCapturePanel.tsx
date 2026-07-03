"use client";
/* eslint-disable @next/next/no-img-element -- reviewed photos use ephemeral blob URLs that must not enter Next image optimization */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCcw, ShieldAlert, Trash2, X } from "lucide-react";
import { fetchPhotoModerationStatus, moderatePhotoWithAzure } from "@/lib/photo/moderationClient";
import { clearCanvas, sanitizePhotoCapture } from "@/lib/photo/sanitize";
import type { CameraFacingEvidence, CameraFacingMode, EphemeralPhotoDraft, PhotoCaptureStatus, PhotoModerationStatus, PhotoObservationMetadata, RequestedCameraFacingMode } from "@/lib/photo/types";

const bodyRegions = ["Right wrist / hand", "Left wrist / hand", "Right arm", "Left arm", "Right leg", "Left leg", "Chest / breathing", "Skin area", "Other"];
const neutralTags = ["Appearance", "Movement", "Change over time", "Size reference"];

const preferredCameraConstraints: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "user" },
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24, max: 30 }
  },
  audio: false
};

const fallbackCameraConstraints: MediaStreamConstraints = { video: true, audio: false };

type Props = {
  onApprove: (draft: EphemeralPhotoDraft, metadata: PhotoObservationMetadata) => void;
  onClose: () => void;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorCode: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(errorCode)), timeoutMs);
    promise.then((value) => {
      window.clearTimeout(timeout);
      resolve(value);
    }, (error) => {
      window.clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForMetadata(video: HTMLVideoElement) {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("camera_metadata_error"));
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function waitForFirstVideoFrame(video: HTMLVideoElement) {
  return new Promise<void>((resolve) => {
    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback(() => resolve());
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function normalizeFacingMode(value: unknown): CameraFacingMode {
  return value === "user" || value === "environment" || value === "left" || value === "right" ? value : "unknown";
}

export function shouldMirrorPreview(evidence: CameraFacingEvidence) {
  if (evidence.reportedFacingMode === "environment" || evidence.requestedFacingMode === "environment") return false;
  if (evidence.reportedFacingMode === "user") return true;
  if (evidence.requestedFacingMode === "user" && evidence.reportedFacingMode === "unknown") return true;
  if (evidence.reportedFacingMode === "unknown") return true;
  return false;
}

function statusMessage(status: PhotoCaptureStatus) {
  if (status === "checking_capture") return "Checking this photo before adding it…";
  if (status === "reviewing") return "Photo check complete. Review the photo before adding it.";
  if (status === "moderation_uncertain") return "Sema could not confidently approve this photo. Try taking it again with a clearer view, or continue using text or the body map.";
  if (status === "moderation_blocked") return "Photo blocked for privacy\n\nAutomated screening flagged this photo as potentially sensitive, so Sema cannot add it. You can retake the photo or continue using text or the body map.";
  if (status === "moderation_unavailable") return "Photo screening is unavailable, so this image cannot be added right now. You can continue using text or the body map.";
  if (status === "requesting_permission") return "Opening camera…";
  if (status === "previewing") return "Camera ready. Capture one photo when you are ready.";
  if (status === "permission_denied") return "Camera permission was not granted. You can continue with text or the body map.";
  if (status === "camera_unavailable") return "Camera capture is unavailable. You can continue with text or the body map.";
  return "";
}

export function PhotoCapturePanel({ onApprove, onClose }: Props) {
  const [status, setStatus] = useState<PhotoCaptureStatus>("azure_disclosure_required");
  const [moderationStatus, setModerationStatus] = useState<PhotoModerationStatus>({ available: false, provider: "azure_content_safety" });
  const [moderationStatusLoaded, setModerationStatusLoaded] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [draft, setDraft] = useState<EphemeralPhotoDraft | null>(null);
  const [note, setNote] = useState("");
  const [bodyLocation, setBodyLocation] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [includeInPacket, setIncludeInPacket] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [moderationInFlight, setModerationInFlight] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeModerationRef = useRef(false);
  const mountedRef = useRef(true);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const discardDraft = useCallback((close = false) => {
    if (draft) URL.revokeObjectURL(draft.objectUrl);
    setDraft(null);
    setNote("");
    setBodyLocation("");
    setTags([]);
    setIncludeInPacket(false);
    setErrorText(null);
    stopStream();
    setStatus(close ? "discarded" : "azure_disclosure_required");
    if (close) onClose();
  }, [draft, onClose, stopStream]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    fetchPhotoModerationStatus(controller.signal)
      .then((result) => {
        if (!mountedRef.current) return;
        setModerationStatus(result);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setModerationStatus({ available: false, provider: "azure_content_safety" });
      })
      .finally(() => {
        if (mountedRef.current) setModerationStatusLoaded(true);
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
      stopStream();
      if (draft) URL.revokeObjectURL(draft.objectUrl);
    };
  }, [draft, stopStream]);

  async function startCamera() {
    if (!disclosureAccepted || !moderationStatus.available) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("camera_unavailable");
      return;
    }
    setErrorText(null);
    setStatus("requesting_permission");
    try {
      let stream: MediaStream;
      let requested: RequestedCameraFacingMode = "user";
      try {
        stream = await withTimeout(navigator.mediaDevices.getUserMedia(preferredCameraConstraints), 8_000, "camera_permission_timeout");
      } catch (error) {
        if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) throw error;
        requested = "unspecified";
        stream = await withTimeout(navigator.mediaDevices.getUserMedia(fallbackCameraConstraints), 6_000, "camera_fallback_timeout");
      }
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const facing = normalizeFacingMode(track?.getSettings?.().facingMode);
      setMirrorPreview(shouldMirrorPreview({ requestedFacingMode: requested, reportedFacingMode: facing }));
      track?.addEventListener("ended", () => {
        stopStream();
        setStatus("camera_unavailable");
      }, { once: true });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const video = videoRef.current;
      if (!video) throw new Error("camera_preview_unavailable");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await withTimeout(waitForMetadata(video), 4_000, "camera_metadata_timeout");
      await video.play().catch(() => undefined);
      await withTimeout(waitForFirstVideoFrame(video), 4_000, "camera_first_frame_timeout");
      setStatus("previewing");
    } catch (error) {
      stopStream();
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) setStatus("permission_denied");
      else setStatus("camera_unavailable");
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || activeModerationRef.current || status !== "previewing") return;
    activeModerationRef.current = true;
    setModerationInFlight(true);
    setStatus("checking_capture");
    setErrorText(null);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { alpha: false });
    let objectUrl: string | undefined;
    try {
      if (!context || !canvas.width || !canvas.height) throw new Error("frame_invalid");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const sanitized = await sanitizePhotoCapture(canvas, canvas.width, canvas.height);
      const runtimePhotoId = `photo-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const result = await moderatePhotoWithAzure({ blob: sanitized.blob, runtimePhotoId, consent: true });
      if (!mountedRef.current) return;
      if (result.outcome !== "allowed") {
        setStatus(result.outcome === "uncertain" ? "moderation_uncertain" : result.outcome === "blocked" ? "moderation_blocked" : "moderation_unavailable");
        setErrorText(result.message);
        return;
      }
      objectUrl = URL.createObjectURL(sanitized.blob);
      const createdAt = new Date().toISOString();
      const nextDraft: EphemeralPhotoDraft = {
        id: runtimePhotoId,
        createdAt,
        width: sanitized.width,
        height: sanitized.height,
        mimeType: sanitized.mimeType,
        sizeBytes: sanitized.sizeBytes,
        note: "",
        bodyLocation: undefined,
        tags: [],
        includeInPacket: false,
        source: "patient_camera_capture",
        privacyGuardStatus: "passed_automated_content_screening",
        availability: "current_tab_only",
        blob: sanitized.blob,
        objectUrl,
        moderationProvider: "azure_content_safety",
        status: "needs_review"
      };
      objectUrl = undefined;
      stopStream();
      setDraft(nextDraft);
      setStatus("reviewing");
    } catch {
      setStatus("moderation_unavailable");
      setErrorText(statusMessage("moderation_unavailable"));
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      activeModerationRef.current = false;
      setModerationInFlight(false);
      clearCanvas(canvas);
    }
  }

  function approve() {
    if (!draft) return;
    setStatus("saving");
    const approved: EphemeralPhotoDraft = {
      ...draft,
      note: note.trim(),
      bodyLocation: bodyLocation || undefined,
      tags,
      includeInPacket,
      status: "approved"
    };
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
    setStatus("saved");
    onClose();
  }

  const disclosureUnavailable = moderationStatusLoaded && !moderationStatus.available;
  const message = errorText ?? statusMessage(status);

  return (
    <section className="mt-5 rounded-lg border border-sema-border bg-[#f8fbfd] p-4 sm:p-5" aria-labelledby="photo-capture-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-sema-blue">AZURE-MODERATED PHOTO CAPTURE</p>
          <h3 id="photo-capture-title" className="mt-1 text-xl font-bold text-ink">Take a photo</h3>
        </div>
        <button type="button" onClick={() => discardDraft(true)} className="min-h-11 rounded-md px-3 text-sm font-semibold text-sema-slate hover:bg-white" aria-label="Close photo capture"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      <p aria-live="polite" className="sr-only">{message}</p>

      {status === "azure_disclosure_required" || status === "idle" ? (
        <div className="mt-4 rounded-md border border-[#c5dbe9] bg-white p-4">
          <p className="text-sm leading-6 text-sema-slate">Photo capture is optional. After you take a photo, Sema will send one temporary copy to Microsoft Azure AI Content Safety to screen for potentially sensitive content. The image leaves this device for processing. Sema does not save moderation copies, and automated screening can make mistakes.</p>
          <label className="mt-4 flex min-h-11 items-start gap-3 rounded-md border border-sema-border bg-[#f8fbfd] p-3 text-sm text-ink">
            <input type="checkbox" checked={disclosureAccepted} onChange={(event) => setDisclosureAccepted(event.target.checked)} className="mt-1" />
            <span>I understand that a captured photo will be sent to Microsoft Azure for automated content-safety screening.</span>
          </label>
          {disclosureUnavailable && <FallbackMessage message="Photo screening is unavailable, so camera photo capture is disabled right now. You can continue using text, the body map, or motion notes." />}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => discardDraft(true)} className="min-h-11 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-sema-slate">Use text or body map instead</button>
            <button type="button" onClick={startCamera} disabled={!disclosureAccepted || !moderationStatus.available} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-sema-slate/40"><Camera className="h-4 w-4" aria-hidden="true" />Continue to camera</button>
          </div>
        </div>
      ) : status === "permission_denied" || status === "camera_unavailable" || status === "moderation_uncertain" || status === "moderation_blocked" || status === "moderation_unavailable" ? (
        <div className="mt-4">
          <FallbackMessage message={message || "Photo capture is unavailable. You can continue with text or the body map."} />
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => { setStatus("azure_disclosure_required"); setErrorText(null); }} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold"><RotateCcw className="h-4 w-4" aria-hidden="true" />Retake</button>
            <button type="button" onClick={() => discardDraft(true)} className="min-h-11 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-sema-slate">Use text or body map instead</button>
          </div>
        </div>
      ) : status === "reviewing" && draft ? (
        <div className="mt-4">
          <p className="rounded-md border border-sema-border bg-white p-3 text-sm text-sema-slate">This photo passed automated content screening. Sema has not medically analyzed it.</p>
          <img src={draft.objectUrl} alt="Photo awaiting your review" className="mt-4 max-h-[28rem] w-full rounded-md border border-sema-border bg-black object-contain" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="text-sm font-semibold text-ink">Neutral note, optional</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="mt-1 min-h-20 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm" placeholder="Describe only what you noticed." /></label>
            <label><span className="text-sm font-semibold text-ink">Body location, optional</span><select value={bodyLocation} onChange={(event) => setBodyLocation(event.target.value)} className="mt-1 w-full rounded-md border border-sema-border bg-white px-3 py-2 text-sm"><option value="">Not selected</option>{bodyRegions.map((region) => <option key={region}>{region}</option>)}</select></label>
            <fieldset><legend className="text-sm font-semibold text-ink">Neutral tags, optional</legend><div className="mt-1 flex flex-wrap gap-2">{neutralTags.map((tag) => <label key={tag} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-sema-border bg-white px-3 text-xs"><input type="checkbox" checked={tags.includes(tag)} onChange={(event) => setTags((current) => event.target.checked ? [...current, tag] : current.filter((item) => item !== tag))} />{tag}</label>)}</div></fieldset>
          </div>
          <label className="mt-4 flex min-h-11 items-center gap-3 rounded-md border border-sema-border bg-white p-3 text-sm"><input type="checkbox" checked={includeInPacket} onChange={(event) => setIncludeInPacket(event.target.checked)} />Include in current evidence packet</label>
          <p className="mt-2 text-xs font-semibold text-sema-blue">Photo available in this tab only</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={approve} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white"><Check className="h-4 w-4" aria-hidden="true" />I reviewed this photo and want to add it to this Sema session.</button>
            <button type="button" onClick={() => discardDraft()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold"><RotateCcw className="h-4 w-4" aria-hidden="true" />Retake</button>
            <button type="button" onClick={() => discardDraft(true)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#d6a9a9] bg-white px-4 py-2 text-sm font-semibold text-[#9b4141]"><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="relative overflow-hidden rounded-md bg-black">
            <video ref={videoRef} muted playsInline className={`aspect-video w-full object-cover transition ${mirrorPreview ? "scale-x-[-1]" : ""} ${status === "checking_capture" ? "opacity-60" : ""}`} />
            {status === "checking_capture" && <div className="absolute inset-0 flex items-center justify-center bg-ink/75 p-5 text-center text-sm font-semibold text-white"><ShieldAlert className="mr-2 h-5 w-5" aria-hidden="true" />Checking this photo before adding it…</div>}
          </div>
          <label className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-sema-border bg-white px-3 text-xs font-semibold text-sema-slate">
            <input type="checkbox" checked={mirrorPreview} onChange={(event) => setMirrorPreview(event.target.checked)} />
            Mirror preview
          </label>
          {mirrorPreview && <p className="mt-2 rounded-md border border-sema-border bg-white p-2 text-xs text-sema-slate"><span className="font-semibold text-sema-blue">Mirrored preview.</span> This only changes the live preview. The captured image, Azure moderation input, review image, and PDF keep the camera’s original orientation.</p>}
          <p className="mt-3 text-sm font-semibold text-sema-blue" aria-live="polite">{message || "Camera ready."}</p>
          <button type="button" onClick={capture} disabled={status !== "previewing" || moderationInFlight} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-md bg-sema-blue px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-sema-slate/40"><Camera className="h-4 w-4" aria-hidden="true" />Capture</button>
        </div>
      )}
    </section>
  );
}

function FallbackMessage({ message }: { message: string }) {
  return <p className="mt-4 whitespace-pre-line rounded-md border border-[#e3c6a0] bg-[#fff8ec] p-4 text-sm leading-6 text-sema-slate">{message}</p>;
}
