import { useEffect, useState } from 'react';

const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

function findVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = synth()?.getVoices() ?? [];
  const base = lang.split('-')[0]!.toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === base)
  );
}

/**
 * A voice for this language on this phone, if there is one. Voices load
 * asynchronously, and some browsers (Chrome on Android, in an installed app)
 * don't always fire "voiceschanged", so it also looks again for a few seconds.
 */
export function useVoice(lang: string): SpeechSynthesisVoice | undefined {
  const [voice, setVoice] = useState(() => findVoice(lang));
  useEffect(() => {
    const s = synth();
    if (!s) return;
    const update = () => setVoice(findVoice(lang));
    update();
    s.addEventListener('voiceschanged', update);
    let tries = 0;
    const poll = setInterval(() => {
      update();
      if (++tries >= 10 || findVoice(lang)) clearInterval(poll);
    }, 400);
    return () => {
      s.removeEventListener('voiceschanged', update);
      clearInterval(poll);
    };
  }, [lang]);
  return voice;
}

/**
 * Reads a text aloud. Chrome can be left paused after the app was in the
 * background, and can drop an utterance queued right after cancel(), so it
 * resumes first and only cancels what is actually playing. It speaks right
 * away, inside the tap: iPhones only allow speech that starts from one. Calls
 * `onError` when the phone's speech engine reports a failure.
 */
export function speak(text: string, voice: SpeechSynthesisVoice, onError?: (reason: string) => void): void {
  const s = synth();
  if (!s) return;
  if (s.speaking || s.pending) s.cancel();
  s.resume();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.85;
  u.onerror = (e) => {
    // Stopping one phrase to start another isn't a failure.
    if (e.error !== 'interrupted' && e.error !== 'canceled') onError?.(e.error);
  };
  s.speak(u);
}
