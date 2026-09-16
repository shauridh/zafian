"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { seedFromSupabase } from "@/lib/db";
import { setSupabaseClient, startAutoSync, stopAutoSync } from "@/lib/sync";

/**
 * Initializes offline-first infrastructure:
 * 1. Seeds local Dexie database from Supabase on first load
 * 2. Starts auto-sync service (push local → Supabase when online)
 */
export default function OfflineProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Set Supabase client for sync service
    setSupabaseClient(supabase);

    // Seed local database from Supabase
    async function init() {
      try {
        await seedFromSupabase(supabase);
        console.log("[Offline] Local database seeded");
      } catch (err) {
        console.error("[Offline] Seed failed:", err);
      }
    }

    init();

    // Start auto-sync (every 30 seconds when online)
    startAutoSync(30000);

    return () => {
      stopAutoSync();
    };
  }, []);

  return <>{children}</>;
}
