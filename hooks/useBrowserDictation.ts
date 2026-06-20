"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appendUniqueTranscript, getSpeechRecognitionConstructor, type BrowserSpeechRecognition } from "@/lib/voice/browserDictation";

export function useBrowserDictation(onFinalTranscript: (text: string) => void) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const finalRef = useRef("");
  const [interim, setInterim] = useState("");
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const supported = typeof window !== "undefined" && Boolean(getSpeechRecognitionConstructor(window));

  const stop = useCallback((abort = false) => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        if (abort) recognition.abort();
        else recognition.stop();
      } catch {
        // The browser may already have ended recognition.
      }
    }
    setActive(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (!supported || recognitionRef.current) return false;
    const Constructor = getSpeechRecognitionConstructor(window);
    if (!Constructor) return false;
    try {
      const recognition = new Constructor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        let nextInterim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result.isFinal) {
            finalRef.current = appendUniqueTranscript(finalRef.current, result[0].transcript);
            onFinalTranscript(finalRef.current);
          } else {
            nextInterim += result[0].transcript;
          }
        }
        setInterim(nextInterim.trim());
      };
      recognition.onerror = () => {
        recognitionRef.current = null;
        setFailed(true);
        setActive(false);
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        setActive(false);
      };
      recognitionRef.current = recognition;
      recognition.start();
      setFailed(false);
      setActive(true);
      return true;
    } catch {
      setFailed(true);
      return false;
    }
  }, [onFinalTranscript, supported]);

  const reset = useCallback(() => {
    stop(true);
    finalRef.current = "";
    setFailed(false);
  }, [stop]);

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.abort();
    } catch {
      // Ignore late browser cleanup errors.
    }
  }, []);

  return { supported, active, interim, failed, start, stop, reset };
}
