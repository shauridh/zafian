"use client";

import { useState, useEffect } from "react";

export interface FeatureToggles {
  tableSelector: boolean;
  onlineFood: boolean;
  preOrder: boolean;
  cashInOut: boolean;
  loyalty: boolean;
  promo: boolean;
  customerPortal: boolean;
  showHPP: boolean;
}

const DEFAULT_FEATURES: FeatureToggles = {
  tableSelector: true,
  onlineFood: true,
  preOrder: true,
  cashInOut: true,
  loyalty: true,
  promo: true,
  customerPortal: true,
  showHPP: false,
};

export function useFeatureToggles(): FeatureToggles {
  const [features, setFeatures] = useState<FeatureToggles>(DEFAULT_FEATURES);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sabana-features");
      if (saved) {
        setFeatures({ ...DEFAULT_FEATURES, ...JSON.parse(saved) });
      }
    } catch {
      // use defaults
    }

    // Listen for storage changes (when settings page saves)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "sabana-features" && e.newValue) {
        try {
          setFeatures({ ...DEFAULT_FEATURES, ...JSON.parse(e.newValue) });
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener("storage", handleStorage);

    // Also poll localStorage every 2s for same-tab updates
    const interval = setInterval(() => {
      try {
        const saved = localStorage.getItem("sabana-features");
        if (saved) {
          setFeatures((prev) => {
            const next = { ...DEFAULT_FEATURES, ...JSON.parse(saved) };
            // Only update if actually changed
            if (JSON.stringify(prev) !== JSON.stringify(next)) return next;
            return prev;
          });
        }
      } catch {
        // ignore
      }
    }, 2000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, []);

  return features;
}
