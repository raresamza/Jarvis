"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

const ENABLED_STORAGE_KEY =
  "jarvis:speech-enabled";

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
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

function getSpeechSupportServerSnapshot(): boolean {
  return false;
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

export function useJarvisSpeech() {
  const supported = useSyncExternalStore(
    subscribeToSpeechSupport,
    getSpeechSupportSnapshot,
    getSpeechSupportServerSnapshot,
  );

  const [enabled, setEnabledState] =
    useState(true);

  const [speaking, setSpeaking] =
    useState(false);

  const [voices, setVoices] = useState<
    SpeechSynthesisVoice[]
  >([]);

  const [voiceName, setVoiceNameState] =
    useState("");

  useEffect(() => {
    if (!supported) {
      return;
    }

    let cancelled = false;

    const storedEnabled =
      window.localStorage.getItem(
        ENABLED_STORAGE_KEY,
      );

    const storedVoice =
      window.localStorage.getItem(
        VOICE_STORAGE_KEY,
      );

    const loadVoices = (): void => {
      if (cancelled) {
        return;
      }

      const availableVoices =
        window.speechSynthesis
          .getVoices()
          .slice()
          .sort((left, right) =>
            left.name.localeCompare(
              right.name,
            ),
          );

      setVoices(availableVoices);

      if (
        storedVoice &&
        availableVoices.some(
          (voice) =>
            voice.name === storedVoice,
        )
      ) {
        setVoiceNameState(storedVoice);
        return;
      }

      const defaultVoice =
        chooseDefaultVoice(
          availableVoices,
        );

      if (defaultVoice) {
        setVoiceNameState(
          defaultVoice.name,
        );
      }
    };

    /*
     * Run initial state synchronization outside
     * the immediate effect body.
     */
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      if (storedEnabled !== null) {
        setEnabledState(
          storedEnabled === "true",
        );
      }

      loadVoices();
    });

    window.speechSynthesis.addEventListener(
      "voiceschanged",
      loadVoices,
    );

    return () => {
      cancelled = true;

      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        loadVoices,
      );
    };
  }, [supported]);

  const stop = useCallback((): void => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }

    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

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

  const speak = useCallback(
    (text: string): void => {
      const normalizedText =
        text.trim();

      if (
        !enabled ||
        !supported ||
        !normalizedText
      ) {
        return;
      }

      window.speechSynthesis.cancel();

      const utterance =
        new SpeechSynthesisUtterance(
          normalizedText,
        );

      const selectedVoice =
        voices.find(
          (voice) =>
            voice.name === voiceName,
        ) ??
        chooseDefaultVoice(voices);

      if (selectedVoice) {
        utterance.voice =
          selectedVoice;

        utterance.lang =
          selectedVoice.lang;
      } else {
        utterance.lang = "en-US";
      }

      utterance.rate = 0.94;
      utterance.pitch = 0.88;
      utterance.volume = 1;

      utterance.addEventListener(
        "start",
        () => {
          setSpeaking(true);
        },
      );

      utterance.addEventListener(
        "end",
        () => {
          setSpeaking(false);
        },
      );

      utterance.addEventListener(
        "error",
        () => {
          setSpeaking(false);
        },
      );

      window.speechSynthesis.speak(
        utterance,
      );
    },
    [
      enabled,
      supported,
      voiceName,
      voices,
    ],
  );

  return {
    supported,
    enabled,
    speaking,
    voices,
    voiceName,
    setEnabled,
    setVoiceName,
    speak,
    stop,
  };
}