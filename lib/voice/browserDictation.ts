export type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

export type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export function getSpeechRecognitionConstructor(scope: Window & typeof globalThis) {
  const candidate = scope as typeof scope & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition;
}

export function appendUniqueTranscript(current: string, next: string) {
  const clean = next.trim();
  if (!clean) return current.trim();
  const normalizedCurrent = current.trim();
  if (normalizedCurrent.endsWith(clean)) return normalizedCurrent;
  return [normalizedCurrent, clean].filter(Boolean).join(" ");
}
