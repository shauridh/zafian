/**
 * Loyalty Service
 * Customer lookup, points/stamps earning, reward redemption
 */
import { supabase } from "./supabase/client";

export interface LoyaltyCustomer {
  id: string;
  phone: string;
  name: string;
  points: number;
  stamps: number;
  total_spent: number;
}

const POINTS_PER_RP = 10; // 1 point per Rp 10.000
const STAMP_PER_TRANSACTION = 1; // 1 stamp per transaction
const STAMP_GOAL = 10; // 10 stamps = reward
const REWARD_VALUE = 15000; // Rp 15.000 reward

/**
 * Find customer by phone number
 */
export async function findCustomerByPhone(phone: string): Promise<LoyaltyCustomer | null> {
  try {
    // Normalize phone: remove spaces, dashes, +62 prefix
    const normalized = phone.replace(/[\s\-+]/g, "").replace(/^62/, "0");
    
    const { data, error } = await supabase
      .from("loyalty_customers")
      .select("*")
      .or(`phone.eq.${normalized},phone.eq.+62${normalized.slice(1)},phone.eq.62${normalized.slice(1)}`)
      .single();

    if (error || !data) return null;
    return data;
  } catch (err) {
    return null;
  }
}

/**
 * Create new customer
 */
export async function createCustomer(name: string, phone: string): Promise<LoyaltyCustomer | null> {
  try {
    const { data, error } = await supabase
      .from("loyalty_customers")
      .insert({ name, phone, points: 0, stamps: 0, total_spent: 0 })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error("[Loyalty] Error creating customer:", err);
    return null;
  }
}

/**
 * Earn points and stamps after a transaction
 */
export async function earnPoints(
  customerId: string,
  orderId: string,
  transactionAmount: number
): Promise<{ points_earned: number; stamps_earned: number; new_total_points: number; new_stamps: number; reward_earned: boolean }> {
  try {
    // Calculate points and stamps
    const pointsEarned = Math.floor(transactionAmount / (POINTS_PER_RP * 1000));
    const stampsEarned = STAMP_PER_TRANSACTION;

    // Get current customer data
    const { data: customer } = await supabase
      .from("loyalty_customers")
      .select("points, stamps, total_spent")
      .eq("id", customerId)
      .single();

    if (!customer) return { points_earned: 0, stamps_earned: 0, new_total_points: 0, new_stamps: 0, reward_earned: false };

    const newPoints = customer.points + pointsEarned;
    const newStamps = customer.stamps + stampsEarned;
    const rewardEarned = newStamps > 0 && Math.floor(newStamps / STAMP_GOAL) > Math.floor(customer.stamps / STAMP_GOAL);

    // Update customer
    await supabase.from("loyalty_customers").update({
      points: newPoints,
      stamps: newStamps,
      total_spent: (customer.total_spent || 0) + transactionAmount,
    }).eq("id", customerId);

    // Log transaction
    await supabase.from("loyalty_transactions").insert({
      customer_id: customerId,
      order_id: orderId,
      points_earned: pointsEarned,
      stamps_earned: stampsEarned,
    });

    return {
      points_earned: pointsEarned,
      stamps_earned: stampsEarned,
      new_total_points: newPoints,
      new_stamps: newStamps,
      reward_earned: rewardEarned,
    };
  } catch (err) {
    console.error("[Loyalty] Error earning points:", err);
    return { points_earned: 0, stamps_earned: 0, new_total_points: 0, new_stamps: 0, reward_earned: false };
  }
}

/**
 * Redeem points for discount
 */
export async function redeemPoints(
  customerId: string,
  pointsToRedeem: number
): Promise<{ success: boolean; discount: number }> {
  try {
    const { data: customer } = await supabase
      .from("loyalty_customers")
      .select("points")
      .eq("id", customerId)
      .single();

    if (!customer || customer.points < pointsToRedeem) {
      return { success: false, discount: 0 };
    }

    // 100 points = Rp 1.000 discount
    const discount = Math.floor(pointsToRedeem / 100) * 1000;
    const pointsUsed = Math.floor(discount / 1000) * 100;

    await supabase.from("loyalty_customers").update({
      points: customer.points - pointsUsed,
    }).eq("id", customerId);

    // Log redemption
    await supabase.from("loyalty_transactions").insert({
      customer_id: customerId,
      points_redeemed: pointsUsed,
    });

    return { success: true, discount };
  } catch (err) {
    console.error("[Loyalty] Error redeeming points:", err);
    return { success: false, discount: 0 };
  }
}

/**
 * Get tier info for a customer
 */
export function getCustomerTier(points: number) {
  if (points >= 5000) return { label: "Platinum", icon: "💎", color: "text-purple-600" };
  if (points >= 2000) return { label: "Gold", icon: "🥇", color: "text-yellow-600" };
  if (points >= 500) return { label: "Silver", icon: "🥈", color: "text-gray-600" };
  return { label: "Bronze", icon: "🥉", color: "text-orange-600" };
}

export const POINTS_CONFIG = { POINTS_PER_RP, STAMP_GOAL, REWARD_VALUE, STAMP_PER_TRANSACTION };
