// Catalog of what the chat can run and which generation services kadr can
// call. Shared by the server (to know how to call each one) and the settings UI
// (to show the choices). Keys never appear here: they live in the user's
// settings file (~/.config/kadr/settings.json), outside every project.

/** Coding-agent CLIs the chat can drive. `bin` is looked up on PATH. */
export const AGENTS = {
  claude: { name: 'Claude Code', bin: 'claude', note: 'Your Claude login, no API key. Best tool support.' },
  codex: { name: 'Codex', bin: 'codex', note: 'OpenAI Codex CLI with your ChatGPT login or key.' },
  gemini: { name: 'Gemini CLI', bin: 'gemini', note: 'Google Gemini CLI with your Google login or key.' },
  opencode: { name: 'OpenCode', bin: 'opencode', note: 'OpenCode with whatever provider you set up in it.' },
  api: { name: 'API key', bin: null, note: 'kadr runs the agent itself and calls a model API with your key.' },
};

/** Model APIs for the built-in agent (agent = "api"). */
export const LLM = {
  anthropic: { name: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], key: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', key: true, keyUrl: 'https://platform.openai.com/api-keys' },
  openrouter: { name: 'OpenRouter (many models)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', key: true, keyUrl: 'https://openrouter.ai/keys' },
  gemini: { name: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', key: true, keyUrl: 'https://aistudio.google.com/apikey' },
  ollama: { name: 'Ollama (local, free)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', key: false },
  custom: { name: 'Other (OpenAI-compatible)', kind: 'openai', baseUrl: '', model: '', key: true },
};

/** Text-to-image services for `kadr gen image`. */
export const IMAGE = {
  openai: { name: 'OpenAI Images', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', key: true, keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash-image', key: true, keyUrl: 'https://aistudio.google.com/apikey' },
  custom: { name: 'Other (OpenAI-compatible)', kind: 'openai', baseUrl: '', model: '', key: true },
};

/** Text-to-speech services for `kadr gen speech`. */
export const SPEECH = {
  openai: { name: 'OpenAI TTS', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy', key: true, keyUrl: 'https://platform.openai.com/api-keys' },
  elevenlabs: { name: 'ElevenLabs', kind: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io/v1', model: 'eleven_multilingual_v2', voice: '', key: true, keyUrl: 'https://elevenlabs.io/app/settings/api-keys', voiceHint: 'voice id from your ElevenLabs voice library' },
  piper: { name: 'Piper (local, free)', kind: 'piper', bin: 'piper', model: '', voice: '', key: false, modelHint: 'path to a .onnx voice file' },
  espeak: { name: 'eSpeak NG (local, robotic)', kind: 'espeak', bin: 'espeak-ng', model: '', voice: 'en', key: false, voiceHint: 'language code: en, fa, de…' },
  custom: { name: 'Other (OpenAI-compatible)', kind: 'openai', baseUrl: '', model: '', voice: '', key: true },
};

/** Speech-to-text services for `kadr gen transcribe` (word timing for captions). */
export const TRANSCRIBE = {
  openai: { name: 'OpenAI Whisper', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', key: true, keyUrl: 'https://platform.openai.com/api-keys' },
  groq: { name: 'Groq Whisper (fast)', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3', key: true, keyUrl: 'https://console.groq.com/keys' },
  custom: { name: 'Other (OpenAI-compatible)', kind: 'openai', baseUrl: '', model: '', key: true },
};

export const SERVICES = { llm: LLM, image: IMAGE, speech: SPEECH, transcribe: TRANSCRIBE };
