// Supported languages for STT + translation (Greek supported at service level)
export type Language = "en" | "el" | "fr" | "de" | "ru";

export interface Settings {
  listenLang: Language;
  translateLang: Language;
}

export interface Session {
  id: string;
  deviceId: string;
  createdAt: string;
  listenLang: Language;
  translateLang: Language;
  preview: string | null;
}

export interface Paragraph {
  id: string;
  sessionId: string;
  position: number;
  original: string;
  translation: string;
}

export interface SessionListResponse {
  sessions: Session[];
  cursor: string | null;
}

export interface SessionDetailResponse {
  session: Session;
  paragraphs: Paragraph[];
  cursor: string | null;
}

export interface MaskedKeys {
  elevenlabsKey: string | null;
  awsAccessKeyId: string | null;
  awsSecretAccessKey: string | null;
  awsRegion: string | null;
}

export interface ApiKeys {
  elevenlabsKey: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
}
