// Asetussivun tila storage.localista. Päivittyy automaattisesti, kun tausta tai toinen
// välilehti muuttaa tallennettua dataa.
import { useCallback, useEffect, useState } from "react";
import { api, loadState } from "../shared/storage.js";

export function useStore() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const state = await loadState();
      const { manualMoves = {}, aiUnsure = {} } = await api().storage.local.get(["manualMoves", "aiUnsure"]);
      setData({
        ...state,
        manualMoves,
        aiUnsure,
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

// Viestit taustaskriptille (lajittelu, palautus, AI-testi)
export function sendToBackground(message) {
  return api().runtime.sendMessage(message);
}
