import { useEffect, useState } from 'react';

const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

function findVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = synth()?.getVoices() ?? [];
  const base = lang.split('-')[0]!.toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === base)
  );
}

/** A voice for this language on this phone, if there is one (voices load asynchronously). */
export function useVoice(lang: string): SpeechSynthesisVoice | undefined {
  const [voice, setVoice] = useState(() => findVoice(lang));
  useEffect(() => {
    const s = synth();
    if (!s) return;
    const update = () => setVoice(findVoice(lang));
    update();
    s.addEventListener('voiceschanged', update);
    return () => s.removeEventListener('voiceschanged', update);
  }, [lang]);
  return voice;
}

export function speak(text: string, voice: SpeechSynthesisVoice): void {
  const s = synth();
  if (!s) return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.85;
  s.speak(u);
}
