/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_MOCKS?: string;
  readonly VITE_CHATBOT_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
