import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";

type Attention = { count: number; newestNumber: string | null; newestAt: string | null };

const KEY = "esspor-admin-alerts";
const POLL_MS = 60_000;

// A short two-note chime made with the browser's own audio, so there is no file to host.
function chime() {
  try {
    const audio = new AudioContext();
    [660, 880].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, audio.currentTime + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + index * 0.18 + 0.3);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(audio.currentTime + index * 0.18);
      oscillator.stop(audio.currentTime + index * 0.18 + 0.32);
    });
  } catch {
    // Audio may be blocked until the page has been clicked.
  }
}

// While the admin is open, checks once a minute for orders that need action. It shows a
// count in the menu and the tab title and, if switched on, chimes and pops up a
// notification for a new one. Closing the tab stops it: this is not a background service.
export function useOrderAlerts(signedIn: boolean) {
  const [attention, setAttention] = useState<Attention | null>(null);
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "on";
    } catch {
      return false;
    }
  });
  const lastSeen = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  async function setEnabled(on: boolean) {
    if (on && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    if (on) chime();
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      // Remembering the choice is a convenience only.
    }
    setEnabledState(on);
  }

  useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    async function check() {
      if (document.hidden && lastSeen.current !== null) return;
      try {
        const next = await api<Attention>("GET", "/orders/attention");
        if (stopped) return;
        if (lastSeen.current !== null && next.newestAt && next.newestAt !== lastSeen.current && enabledRef.current) {
          chime();
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("New Esspor order", { body: next.newestNumber ? `${next.newestNumber} needs attention.` : "An order needs attention." });
          }
        }
        lastSeen.current = next.newestAt ?? "";
        setAttention(next);
      } catch {
        // Offline or signed out; the next tick tries again.
      }
    }
    void check();
    const timer = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [signedIn]);

  useEffect(() => {
    document.title = attention?.count ? `(${attention.count}) Esspor Admin` : "Esspor Admin";
  }, [attention?.count]);

  return { count: attention?.count ?? 0, enabled, setEnabled };
}
