"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  markdownToSpeechText,
  splitSpeechText,
} from "@/lib/ttsText";

export type JarvisSpeechEngine =
  | "local"
  | "browser";

const ENABLED_STORAGE_KEY =
  "jarvis:speech-enabled";

const ENGINE_STORAGE_KEY =
  "jarvis:speech-engine";

const VOICE_STORAGE_KEY =
  "jarvis:speech-voice";

const preferredVoiceKeywords = [
  "ryan",
  "guy",
  "david",
  "george",
  "mark",
  "james",
  "daniel",
];

function subscribeToSpeechSupport(): () => void {
  return () => {};
}

function getSpeechSupportSnapshot(): boolean {
  return (
    typeof window !== "undefined" &&
    ("Audio" in window ||
      ("speechSynthesis" in window &&
        "SpeechSynthesisUtterance" in
          window))
  );
}

function getSpeechSupportServerSnapshot(): boolean {
  return false;
}

function hasBrowserSpeechSupport(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

function chooseDefaultVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  const englishVoices = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("en"),
  );

  for (const keyword of preferredVoiceKeywords) {
    const matchingVoice = englishVoices.find(
      (voice) =>
        voice.name
          .toLowerCase()
          .includes(keyword),
    );

    if (matchingVoice) {
      return matchingVoice;
    }
  }

  return (
    englishVoices.find((voice) =>
      voice.lang
        .toLowerCase()
        .startsWith("en-gb"),
    ) ??
    englishVoices.find((voice) =>
      voice.lang
        .toLowerCase()
        .startsWith("en-us"),
    ) ??
    englishVoices[0] ??
    voices[0]
  );
}

function isSpeechEngine(
  value: string | null,
): value is JarvisSpeechEngine {
  return value === "local" || value === "browser";
}

export function useJarvisSpeech() {
  const supported = useSyncExternalStore(
    subscribeToSpeechSupport,
    getSpeechSupportSnapshot,
    getSpeechSupportServerSnapshot,
  );

  const [enabled, setEnabledState] =
    useState(true);

  const [engine, setEngineState] =
    useState<JarvisSpeechEngine>("local");

  const [speaking, setSpeaking] =
    useState(false);

  const [speechError, setSpeechError] =
    useState("");

  const [voices, setVoices] = useState<
    SpeechSynthesisVoice[]
  >([]);

  const [voiceName, setVoiceNameState] =
    useState("");

  const audioRef =
    useRef<HTMLAudioElement | null>(null);

  const audioUrlRef = useRef<string | null>(null);

  const requestControllerRef =
    useRef<AbortController | null>(null);

  const releaseLocalAudio = useCallback((): void => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stop = useCallback((): void => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;

    releaseLocalAudio();

    if (hasBrowserSpeechSupport()) {
      window.speechSynthesis.cancel();
    }

    setSpeaking(false);
  }, [releaseLocalAudio]);

  useEffect(() => {
    if (!supported) {
      return;
    }

    let cancelled = false;

    const storedEnabled =
      window.localStorage.getItem(
        ENABLED_STORAGE_KEY,
      );

    const storedEngine =
      window.localStorage.getItem(
        ENGINE_STORAGE_KEY,
      );

    const storedVoice =
      window.localStorage.getItem(
        VOICE_STORAGE_KEY,
      );

    const loadVoices = (): void => {
      if (
        cancelled ||
        !hasBrowserSpeechSupport()
      ) {
        return;
      }

      const availableVoices =
        window.speechSynthesis
          .getVoices()
          .slice()
          .sort((left, right) =>
            left.name.localeCompare(right.name),
          );

      setVoices(availableVoices);

      if (
        storedVoice &&
        availableVoices.some(
          (voice) => voice.name === storedVoice,
        )
      ) {
        setVoiceNameState(storedVoice);
        return;
      }

      const defaultVoice =
        chooseDefaultVoice(availableVoices);

      if (defaultVoice) {
        setVoiceNameState(defaultVoice.name);
      }
    };

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      if (storedEnabled !== null) {
        setEnabledState(
          storedEnabled === "true",
        );
      }

      if (isSpeechEngine(storedEngine)) {
        setEngineState(storedEngine);
      }

      loadVoices();
    });

    if (hasBrowserSpeechSupport()) {
      window.speechSynthesis.addEventListener(
        "voiceschanged",
        loadVoices,
      );
    }

    return () => {
      cancelled = true;

      if (hasBrowserSpeechSupport()) {
        window.speechSynthesis.removeEventListener(
          "voiceschanged",
          loadVoices,
        );
      }

      requestControllerRef.current?.abort();
      releaseLocalAudio();
    };
  }, [releaseLocalAudio, supported]);

  const setEnabled = useCallback(
    (nextEnabled: boolean): void => {
      setEnabledState(nextEnabled);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          ENABLED_STORAGE_KEY,
          String(nextEnabled),
        );
      }

      if (!nextEnabled) {
        stop();
      }
    },
    [stop],
  );

  const setEngine = useCallback(
    (nextEngine: JarvisSpeechEngine): void => {
      stop();
      setEngineState(nextEngine);
      setSpeechError("");

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          ENGINE_STORAGE_KEY,
          nextEngine,
        );
      }
    },
    [stop],
  );

  const setVoiceName = useCallback(
    (nextVoiceName: string): void => {
      setVoiceNameState(nextVoiceName);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          VOICE_STORAGE_KEY,
          nextVoiceName,
        );
      }
    },
    [],
  );

  const speakWithBrowser = useCallback(
    (text: string): boolean => {
      if (!hasBrowserSpeechSupport()) {
        return false;
      }

      window.speechSynthesis.cancel();

      const utterance =
        new SpeechSynthesisUtterance(text);

      const selectedVoice =
        voices.find(
          (voice) => voice.name === voiceName,
        ) ?? chooseDefaultVoice(voices);

      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
      } else {
        utterance.lang = "en-US";
      }

      utterance.rate = 0.94;
      utterance.pitch = 0.88;
      utterance.volume = 1;

      utterance.addEventListener("start", () => {
        setSpeaking(true);
      });

      utterance.addEventListener("end", () => {
        setSpeaking(false);
      });

      utterance.addEventListener("error", () => {
        setSpeaking(false);
      });

      window.speechSynthesis.speak(utterance);
      return true;
    },
    [voiceName, voices],
  );

  const playAudioBlob = useCallback(
    async (
      blob: Blob,
      signal: AbortSignal,
    ): Promise<void> => {
      releaseLocalAudio();

      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);

      audioUrlRef.current = audioUrl;
      audioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          signal.removeEventListener(
            "abort",
            handleAbort,
          );
        };

        const finish = (): void => {
          cleanup();
          releaseLocalAudio();
          resolve();
        };

        const handleAbort = (): void => {
          cleanup();
          releaseLocalAudio();
          reject(
            new DOMException(
              "Speech was stopped.",
              "AbortError",
            ),
          );
        };

        audio.addEventListener("ended", finish, {
          once: true,
        });

        audio.addEventListener(
          "error",
          () => {
            cleanup();
            releaseLocalAudio();
            reject(
              new Error(
                "The generated audio could not be played.",
              ),
            );
          },
          { once: true },
        );

        signal.addEventListener(
          "abort",
          handleAbort,
          { once: true },
        );

        void audio.play().catch((error: unknown) => {
          cleanup();
          releaseLocalAudio();
          reject(error);
        });
      });
    },
    [releaseLocalAudio],
  );

  const speak = useCallback(
    (markdown: string): void => {
      const speechText =
        markdownToSpeechText(markdown);

      if (
        !enabled ||
        !supported ||
        !speechText
      ) {
        return;
      }

      stop();
      setSpeechError("");

      if (engine === "browser") {
        speakWithBrowser(speechText);
        return;
      }

      const segments = splitSpeechText(speechText);

      if (segments.length === 0) {
        return;
      }

      const controller = new AbortController();
      requestControllerRef.current = controller;
      setSpeaking(true);

      void (async () => {
        let segmentIndex = 0;

        try {
          for (
            segmentIndex = 0;
            segmentIndex < segments.length;
            segmentIndex += 1
          ) {
            const response = await fetch("/api/tts", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                text: segments[segmentIndex],
              }),
              signal: controller.signal,
            });

            if (!response.ok) {
              let message =
                "Local neural voice is unavailable.";

              try {
                const payload =
                  (await response.json()) as {
                    error?: unknown;
                  };

                if (
                  typeof payload.error === "string"
                ) {
                  message = payload.error;
                }
              } catch {
                // Keep the fallback message.
              }

              throw new Error(message);
            }

            const blob = await response.blob();

            if (controller.signal.aborted) {
              return;
            }

            await playAudioBlob(
              blob,
              controller.signal,
            );
          }
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          releaseLocalAudio();

          const message =
            error instanceof Error
              ? error.message
              : "Local neural voice is unavailable.";

          const remainingText = segments
            .slice(segmentIndex)
            .join(" ");

          const usedFallback =
            Boolean(remainingText) &&
            speakWithBrowser(remainingText);

          setSpeechError(
            usedFallback
              ? `${message} Using the browser voice for the remaining text.`
              : message,
          );
        } finally {
          if (
            requestControllerRef.current ===
            controller
          ) {
            requestControllerRef.current = null;
            setSpeaking(false);
          }
        }
      })();
    },
    [
      enabled,
      engine,
      playAudioBlob,
      releaseLocalAudio,
      speakWithBrowser,
      stop,
      supported,
    ],
  );

  return {
    supported,
    enabled,
    engine,
    speaking,
    speechError,
    voices,
    voiceName,
    setEnabled,
    setEngine,
    setVoiceName,
    speak,
    stop,
  };
}
