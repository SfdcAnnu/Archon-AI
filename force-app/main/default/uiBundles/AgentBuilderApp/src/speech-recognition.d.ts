// Minimal Web Speech API ambient types — not part of the standard DOM lib.
// Only the shape ChatPanel.tsx actually uses.
interface SpeechRecognitionResultItem {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionResultItem;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}
interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}
