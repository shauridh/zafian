"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Category, Product } from "@/types";

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCategories() {
      try {
        const { data, error } = await supabase
          .from("categories")
          .select("*")
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (error) throw error;
        setCategories(data || []);
      } catch (err: any) {
        console.error("Error fetching categories:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchCategories();
  }, []);

  return { categories, loading, error };
}

export function useProducts(categoryId?: string) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProducts() {
      try {
        let query = supabase
          .from("products")
          .select("*")
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (categoryId) {
          query = query.eq("category_id", categoryId);
        }

        const { data, error } = await query;
        if (error) throw error;
        setProducts(data || []);
      } catch (err: any) {
        console.error("Error fetching products:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, [categoryId]);

  return { products, loading, error };
}

export function useAllProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .order("name");
      setProducts(data || []);
      setLoading(false);
    }
    fetchAll();
  }, []);

  return { products, loading };
}

export function useUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUsers() {
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("is_active", true)
        .order("name");
      setUsers(data || []);
      setLoading(false);
    }
    fetchUsers();
  }, []);

  return { users, loading };
}

export async function createOrder(orderData: any) {
  const { data, error } = await supabase
    .from("orders")
    .insert(orderData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createOrderItems(items: any[]) {
  const { data, error } = await supabase
    .from("order_items")
    .insert(items);
  if (error) throw error;
  return data;
}
