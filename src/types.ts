// Supported languages for STT + translation (Greek supported at service level)
export type Language = "en" | "el" | "fr" | "de";

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
  elevenlabs_key: string | null;
  aws_access_key_id: string | null;
  aws_secret_access_key: string | null;
  aws_region: string | null;
}

export interface ApiKeys {
  elevenlabs_key: string;
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_region: string;
}
