"use client";

import { useRef, useState } from "react";

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(0);
  const chunks = useRef<Blob[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);

  async function start() {
    setError("");

    const isSupported = "MediaRecorder" in window && Boolean(navigator.mediaDevices?.getUserMedia);
    if (!isSupported) {
      setError("Audio recording is not supported in this browser. Use the demo/manual audio note instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      chunks.current = [];
      startedAt.current = Date.now();
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        setAudioUrl(URL.createObjectURL(blob));
        setDurationSeconds(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      setError("Microphone permission was denied or recording failed. Your notes are still available.");
    }
  }

  function stop() {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.stop();
      setIsRecording(false);
    }
  }

  function reset() {
    setAudioUrl("");
    setDurationSeconds(0);
    setError("");
  }

  return { isRecording, error, audioUrl, durationSeconds, start, stop, reset };
}
