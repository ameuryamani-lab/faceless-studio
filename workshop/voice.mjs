// Faceless Studio: pluggable voice step. The narrator in use is Kokoro (workshop/story/make-short.mjs).
// A provider is { name, describe(), async synthesize({ text, out }) -> { path: string | null, seconds?: number } }.
// "none" writes nothing: assembly then lays a silent track, and QC fails the loudness check on purpose
// (a video without a voice is not finished).

export const PROVIDERS = {
  none: {
    name: 'none',
    describe: () => 'no voice yet (silent track; QC loudness will fail until a real provider is chosen)',
    async synthesize() { return { path: null }; },
  },
  // Later, for example: "gemini" or "elevenlabs" — each must stay behind the owner's cost decision and read keys from the
  // studio's own .env through a key-holding service, never from this file.
};

export function getVoiceProvider(name = 'none') {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`voice provider "${name}" is not available (only: ${Object.keys(PROVIDERS).join(', ')})`);
  return p;
}

/** The text to say: storyboard.voice.text, else the shots' lines joined. */
export const voiceText = (sb) => String(sb.voice?.text || sb.shots.map((s) => s.line || '').filter(Boolean).join(' ')).trim();
