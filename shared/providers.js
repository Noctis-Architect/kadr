// Catalog of what the chat can run and which generation services kadr can
// call. Shared by the server (to know how to call each one) and the settings UI
// (to show the choices). Keys never appear here: they live in the user's
// settings file (~/.config/kadr/settings.json), outside every project.

/**
 * Coding-agent CLIs the chat can drive. `bin` is looked up on PATH. `run` is
 * the command line for one message: `limited` (edits + kadr/ffmpeg) and `full`
 * (no confirmations); '{prompt}' is replaced by the message. Claude Code is
 * special (streamed JSON), `custom` comes from the user's own command, `api`
 * is kadr's built-in agent.
 */
export const AGENTS = {
  claude: { name: 'Claude Code', bin: 'claude', note: 'Your Claude login, or GLM / DeepSeek / Kimi behind it. Best tool support.' },
  codex: { name: 'Codex', bin: 'codex', note: 'OpenAI Codex CLI with your ChatGPT login or key.',
    run: { limited: ['exec', '--skip-git-repo-check', '--full-auto', '{prompt}'], full: ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '{prompt}'] } },
  gemini: { name: 'Gemini CLI', bin: 'gemini', note: 'Google Gemini CLI with your Google login or key.',
    run: { limited: ['-p', '{prompt}', '--approval-mode', 'auto_edit', '--allowed-tools', 'run_shell_command(kadr)', 'run_shell_command(ffmpeg)', 'run_shell_command(ffprobe)'], full: ['-p', '{prompt}', '--yolo'] } },
  opencode: { name: 'OpenCode', bin: 'opencode', note: 'OpenCode with any provider you set up in it (DeepSeek, GLM, local models…).',
    run: { limited: ['run', '{prompt}'], full: ['run', '--auto', '{prompt}'] } },
  qoder: { name: 'Qoder CLI', bin: 'qodercli', note: 'Qoder\'s agent with your Qoder account.',
    run: { limited: ['-p', '{prompt}'], full: ['-p', '{prompt}', '--yolo'] } },
  cursor: { name: 'Cursor Agent', bin: 'cursor-agent', note: 'Cursor\'s agent with your Cursor account.',
    run: { limited: ['-p', '{prompt}', '--output-format', 'text'], full: ['-p', '{prompt}', '--output-format', 'text', '--force'] } },
  qwen: { name: 'Qwen Code', bin: 'qwen', note: 'Alibaba\'s Qwen coding agent (free tier with a Qwen account).',
    run: { limited: ['-p', '{prompt}', '--approval-mode', 'auto_edit'], full: ['-p', '{prompt}', '--yolo'] } },
  crush: { name: 'Crush', bin: 'crush', note: 'Charm\'s terminal agent with the providers you set up in it.',
    run: { limited: ['run', '{prompt}'], full: ['run', '{prompt}'] } },
  goose: { name: 'Goose', bin: 'goose', note: 'Block\'s open-source agent with its own provider settings.',
    run: { limited: ['run', '-t', '{prompt}'], full: ['run', '-t', '{prompt}'] } },
  aider: { name: 'Aider', bin: 'aider', note: 'Aider with whatever model you set it up with.',
    run: { limited: ['--message', '{prompt}', '--yes-always', '--no-auto-commits'], full: ['--message', '{prompt}', '--yes-always', '--no-auto-commits'] } },
  amp: { name: 'Amp', bin: 'amp', note: 'Sourcegraph\'s Amp agent.',
    run: { limited: ['-x', '{prompt}'], full: ['-x', '{prompt}', '--dangerously-allow-all'] } },
  custom: { name: 'Your own command', bin: null, note: 'Any agent CLI: you type the command, kadr puts the message where {prompt} is.' },
  api: { name: 'API key', bin: null, note: 'kadr runs the agent itself and calls a model API with your key (DeepSeek, GLM, OpenAI…).' },
};

/**
 * Model services that speak Anthropic's API, so Claude Code (all its tools)
 * can run on them instead of a Claude subscription: Claude Code is started with
 * ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN pointing there.
 */
export const CLAUDE_VIA = {
  zai: { name: 'Z.ai (GLM)', baseUrl: 'https://api.z.ai/api/anthropic', model: '' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat' },
  moonshot: { name: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.ai/anthropic', model: '' },
  custom: { name: 'Other (Anthropic-compatible)', baseUrl: '', model: '' },
};

/** Model APIs for the built-in agent (agent = "api"). */
export const LLM = {
  anthropic: { name: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], key: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', key: true, keyUrl: 'https://platform.openai.com/api-keys' },
  openrouter: { name: 'OpenRouter (many models)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', key: true, keyUrl: 'https://openrouter.ai/keys' },
  gemini: { name: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', key: true, keyUrl: 'https://aistudio.google.com/apikey' },
  deepseek: { name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: true, keyUrl: 'https://platform.deepseek.com/api_keys' },
  zai: { name: 'Z.ai (GLM)', kind: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', model: '', key: true, keyUrl: 'https://z.ai/manage-apikey/apikey-list' },
  moonshot: { name: 'Kimi (Moonshot)', kind: 'openai', baseUrl: 'https://api.moonshot.ai/v1', model: '', key: true, keyUrl: 'https://platform.moonshot.ai/console/api-keys' },
  qwen: { name: 'Qwen (Alibaba Cloud)', kind: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: '', key: true, keyUrl: 'https://bailian.console.alibabacloud.com/?apiKey=1' },
  mistral: { name: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: '', key: true, keyUrl: 'https://console.mistral.ai/api-keys' },
  xai: { name: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', model: '', key: true, keyUrl: 'https://console.x.ai' },
  groq: { name: 'Groq (fast open models)', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: '', key: true, keyUrl: 'https://console.groq.com/keys' },
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

/** Providers whose key is saved once and shared by every service that uses them. */
export const KEYS = {
  openai: { name: 'OpenAI', url: 'https://platform.openai.com/api-keys', uses: 'chat agent, images, voice, transcripts' },
  anthropic: { name: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', uses: 'chat agent' },
  gemini: { name: 'Google Gemini', url: 'https://aistudio.google.com/apikey', uses: 'chat agent, images' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/keys', uses: 'chat agent (many models)' },
  elevenlabs: { name: 'ElevenLabs', url: 'https://elevenlabs.io/app/settings/api-keys', uses: 'voice' },
  groq: { name: 'Groq', url: 'https://console.groq.com/keys', uses: 'chat agent, transcripts' },
  deepseek: { name: 'DeepSeek', url: 'https://platform.deepseek.com/api_keys', uses: 'chat agent, Claude Code' },
  zai: { name: 'Z.ai (GLM)', url: 'https://z.ai/manage-apikey/apikey-list', uses: 'chat agent, Claude Code' },
  moonshot: { name: 'Kimi (Moonshot)', url: 'https://platform.moonshot.ai/console/api-keys', uses: 'chat agent, Claude Code' },
  qwen: { name: 'Qwen (Alibaba Cloud)', url: 'https://bailian.console.alibabacloud.com/?apiKey=1', uses: 'chat agent' },
  mistral: { name: 'Mistral', url: 'https://console.mistral.ai/api-keys', uses: 'chat agent' },
  xai: { name: 'xAI (Grok)', url: 'https://console.x.ai', uses: 'chat agent' },
  pexels: { name: 'Pexels', url: 'https://www.pexels.com/api/', uses: 'stock photos and videos (free key)' },
  pixabay: { name: 'Pixabay', url: 'https://pixabay.com/api/docs/', uses: 'stock photos and videos (free key)' },
};

/** One-line descriptions shown on the choice cards in AI settings. */
export const NOTES = {
  llm: { deepseek: 'Cheap and capable; good at code.', zai: 'GLM models from Zhipu.', moonshot: 'Kimi models; long context.', qwen: 'Qwen models from Alibaba.', mistral: 'Mistral models (EU).', xai: 'Grok models.', groq: 'Open models, very fast.', anthropic: 'Claude models. Strong at editing and checking its work.', openai: 'GPT models from OpenAI.', openrouter: 'One key, hundreds of models.', gemini: 'Google Gemini models.', ollama: 'Runs on this computer. Free, needs Ollama installed.', custom: 'Any server that speaks the OpenAI API.' },
  image: { openai: 'Good all-round images and text in images.', gemini: 'Fast, good for photos and edits.', custom: 'Any server that speaks the OpenAI images API.' },
  speech: { openai: 'Natural voices, many languages.', elevenlabs: 'The most natural voices.', piper: 'Offline and free. Needs a voice file.', espeak: 'Offline and free. Sounds robotic, fine for drafts.', custom: 'Any server that speaks the OpenAI speech API.' },
  transcribe: { openai: 'Whisper: accurate, many languages.', groq: 'Whisper, very fast and cheap.', custom: 'Any server that speaks the OpenAI transcription API.' },
};
