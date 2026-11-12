// Asetussivun tila storage.localista. Päivittyy automaattisesti, kun tausta tai toinen
// välilehti muuttaa tallennettua dataa.
import { useCallback, useEffect, useState } from "react";
import { api, loadState } from "./storage.js";

export function useStore() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const state = await loadState();
      const { manualMoves = {}, aiUnsure = {}, lastRun = null } = await api().storage.local.get([
        "manualMoves",
        "aiUnsure",
        "lastRun",
      ]);
      setData({
        ...state,
        manualMoves,
        aiUnsure,
        lastRun,
        manualCount: Object.keys(manualMoves).length,
        unsureCount: Object.keys(aiUnsure).length,
      });
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    reload();
    const listener = (changes, area) => {
      if (area === "local") reload();
    };
    api().storage.onChanged.addListener(listener);
    return () => api().storage.onChanged.removeListener(listener);
  }, [reload]);

  return { data, error, reload };
}

// Viestit taustaskriptille (lajittelu, palautus, AI-testi, avaimen hallinta)
export function sendToBackground(message) {
  return api().runtime.sendMessage(message);
}

// API-avaimen tila taustaskriptiltä: { state: none|plain|locked|unlocked, protected, last4, sessionStorage }.
// Itse avainta ei koskaan välitetä sivulle.
export function useKeyStatus() {
  const [status, setStatus] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await sendToBackground({ type: "keyStatus" }));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const listener = (changes, area) => {
      if (area === "local" && (changes.settings || changes.apiKeyVault)) refresh();
    };
    api().storage.onChanged.addListener(listener);
    return () => api().storage.onChanged.removeListener(listener);
  }, [refresh]);

  return { status, setStatus, refresh };
}
