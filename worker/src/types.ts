export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ENCRYPTION_KEY: string;
  ELEVENLABS_API_BASE: string;
  AWS_TRANSLATE_ENDPOINT: string;
}

export interface AuthenticatedRequest extends Request {
  deviceId: string;
}

export interface TranslateRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
}

export interface KeysPayload {
  elevenlabs_key: string;
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_region: string;
}

export interface SettingsPayload {
  listenLang: string;
  translateLang: string;
}

export interface MaskedKeys {
  elevenlabs_key: string | null;
  aws_access_key_id: string | null;
  aws_secret_access_key: string | null;
  aws_region: string | null;
}
