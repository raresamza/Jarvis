"use client";

interface JarvisSpeechControlsProps {
  supported: boolean;
  enabled: boolean;
  speaking: boolean;
  voices: SpeechSynthesisVoice[];
  voiceName: string;
  onEnabledChange: (
    enabled: boolean,
  ) => void;
  onVoiceChange: (
    voiceName: string,
  ) => void;
  onStop: () => void;
}

export function JarvisSpeechControls({
  supported,
  enabled,
  speaking,
  voices,
  voiceName,
  onEnabledChange,
  onVoiceChange,
  onStop,
}: JarvisSpeechControlsProps) {
  if (!supported) {
    return (
      <div className="rounded-xl border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">
        Speech output is not supported by
        this browser.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-3 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) =>
              onEnabledChange(
                event.target.checked,
              )
            }
            className="h-4 w-4 accent-sky-500"
          />

          Speak Jarvis responses
        </label>

        {speaking && (
          <button
            type="button"
            onClick={onStop}
            className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-1.5 text-xs font-medium text-red-200 transition hover:border-red-700"
          >
            Stop speaking
          </button>
        )}
      </div>

      {enabled && (
        <label className="block">
          <span className="mb-1.5 block text-xs text-zinc-500">
            Jarvis voice
          </span>

          <select
            value={voiceName}
            onChange={(event) =>
              onVoiceChange(
                event.target.value,
              )
            }
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none transition focus:border-sky-500"
          >
            {voices.map((voice) => (
              <option
                key={`${voice.name}-${voice.lang}`}
                value={voice.name}
              >
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        </label>
      )}

      {speaking && (
        <div className="flex items-center gap-2 text-xs text-sky-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          Jarvis is speaking
        </div>
      )}
    </div>
  );
}
