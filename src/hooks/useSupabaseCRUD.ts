"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";

export function useSupabaseCRUD<T extends { id: string }>(
  tableName: string,
  options?: {
    select?: string;
    orderBy?: { column: string; ascending?: boolean };
    filters?: Record<string, any>;
  }
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from(tableName).select(options?.select || "*");

      // Apply filters
      if (options?.filters) {
        Object.entries(options.filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== "") {
            query = query.eq(key, value);
          }
        });
      }

      // Apply ordering
      if (options?.orderBy) {
        query = query.order(options.orderBy.column, {
          ascending: options.orderBy.ascending ?? true,
        });
      }

      const { data: result, error: fetchError } = await query;
      if (fetchError) throw fetchError;
      setData(result || []);
    } catch (err: any) {
      console.error(`Error fetching ${tableName}:`, err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tableName, options?.select, JSON.stringify(options?.orderBy), JSON.stringify(options?.filters)]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const create = useCallback(
    async (item: Omit<T, "id">) => {
      const { data: result, error } = await supabase
        .from(tableName)
        .insert(item)
        .select()
        .single();
      if (error) throw error;
      setData((prev) => [...prev, result]);
      return result;
    },
    [tableName]
  );

  const update = useCallback(
    async (id: string, updates: Partial<T>) => {
      const { data: result, error } = await supabase
        .from(tableName)
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      setData((prev) => prev.map((item) => (item.id === id ? result : item)));
      return result;
    },
    [tableName]
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from(tableName).delete().eq("id", id);
      if (error) throw error;
      setData((prev) => prev.filter((item) => item.id !== id));
    },
    [tableName]
  );

  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, create, update, remove, refresh };
}
