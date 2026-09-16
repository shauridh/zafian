/**
 * Promo Service
 * Fetches active promos and calculates discounts for POS checkout
 */
import { supabase } from "./supabase/client";

export interface Promo {
  id: string;
  name: string;
  type: "percentage" | "fixed" | "bundle";
  value: number;
  min_purchase: number;
  product_id?: string;
  bundle_id?: string;
  start_date?: string;
  end_date?: string;
  is_active: boolean;
}

export interface PromoResult {
  promo: Promo;
  discount_amount: number;
  description: string;
}

/**
 * Fetch all active and valid promos
 */
export async function getActivePromos(): Promise<Promo[]> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("promos")
      .select("*")
      .eq("is_active", true)
      .or(`start_date.is.null,start_date.lte.${now}`)
      .or(`end_date.is.null,end_date.gte.${now}`);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("[Promo] Error fetching promos:", err);
    return [];
  }
}

/**
 * Calculate the best discount for a cart total
 * Returns the single best promo (highest discount)
 */
export function calculateBestDiscount(
  promos: Promo[],
  cartTotal: number
): PromoResult | null {
  let bestResult: PromoResult | null = null;

  for (const promo of promos) {
    // Check min purchase
    if (promo.min_purchase > 0 && cartTotal < promo.min_purchase) continue;

    let discount = 0;
    let description = "";

    switch (promo.type) {
      case "percentage":
        discount = Math.floor((cartTotal * promo.value) / 100);
        description = `Diskon ${promo.value}% = -Rp ${discount.toLocaleString("id-ID")}`;
        break;
      case "fixed":
        discount = Math.min(promo.value, cartTotal);
        description = `Potongan Rp ${discount.toLocaleString("id-ID")}`;
        break;
      case "bundle":
        // Bundle requires specific products — skip for auto-apply
        continue;
    }

    if (discount > 0) {
      if (!bestResult || discount > bestResult.discount_amount) {
        bestResult = { promo, discount_amount: discount, description };
      }
    }
  }

  return bestResult;
}

/**
 * Apply promo to a transaction (log it)
 */
export async function applyPromoToOrder(
  orderId: string,
  promoId: string,
  discountAmount: number
) {
  try {
    await supabase.from("orders").update({
      discount: discountAmount,
      discount_type: "promo",
      discount_value: discountAmount,
    }).eq("id", orderId);
  } catch (err) {
    console.error("[Promo] Error applying promo:", err);
  }
}
