import { useState } from 'react';

// Picks the best available Japanese voice. Voices load asynchronously in some browsers,
// so this is called fresh on each click rather than cached at module load time.
function getJapaneseVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  return voices.find((v) => v.lang === 'ja-JP') || voices.find((v) => v.lang?.startsWith('ja')) || null;
}

export default function SpeakButton({ text, style }) {
  const [supported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window);
  const [speaking, setSpeaking] = useState(false);

  if (!supported || !text) return null;

  const speak = (e) => {
    e.stopPropagation();
    window.speechSynthesis.cancel(); // stop anything already playing
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    const voice = getJapaneseVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.9;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <button
      type="button"
      onClick={speak}
      title="Listen"
      aria-label="Listen to pronunciation"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: speaking ? 'var(--hanko)' : 'var(--indigo)',
        fontSize: '1.1em',
        padding: '2px 6px',
        lineHeight: 1,
        opacity: speaking ? 1 : 0.8,
        ...style,
      }}
    >
      {speaking ? '🔊' : '🔈'}
    </button>
  );
}
