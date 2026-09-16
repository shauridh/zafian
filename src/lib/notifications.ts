// Push Notification Manager for Sabana POS
// Handles browser push notifications and in-app alerts

import { supabase } from "./supabase";

type NotificationPayload = {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  data?: any;
};

type StockAlert = {
  product_id: string;
  product_name: string;
  current_stock: number;
  min_stock: number;
  severity: "warning" | "critical";
};

class NotificationManager {
  private permission: NotificationPermission = "default";
  private isSupported: boolean;

  constructor() {
    this.isSupported = typeof window !== "undefined" && "Notification" in window;
    if (this.isSupported) {
      this.permission = Notification.permission;
    }
  }

  // Request notification permission
  async requestPermission(): Promise<boolean> {
    if (!this.isSupported) {
      console.log("[Notifications] Not supported in this browser");
      return false;
    }

    if (this.permission === "granted") {
      return true;
    }

    try {
      const result = await Notification.requestPermission();
      this.permission = result;
      return result === "granted";
    } catch (error) {
      console.error("[Notifications] Permission request failed:", error);
      return false;
    }
  }

  // Send browser push notification
  async sendNotification(payload: NotificationPayload): Promise<boolean> {
    if (!this.isSupported || this.permission !== "granted") {
      console.log("[Notifications] Cannot send - permission not granted");
      return false;
    }

    try {
      const notification = new Notification(payload.title, {
        body: payload.body,
        icon: payload.icon || "/icons/icon.svg",
        tag: payload.tag || "sabana-notification",
        data: payload.data,
        badge: "/icons/icon.svg",
        requireInteraction: false,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      // Auto close after 5 seconds
      setTimeout(() => notification.close(), 5000);

      return true;
    } catch (error) {
      console.error("[Notifications] Send failed:", error);
      return false;
    }
  }

  // Check stock levels and send alerts
  async checkStockAlerts(): Promise<StockAlert[]> {
    try {
      // Get products with stock info
      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, name, min_stock, finished_goods(stock)")
        .eq("is_active", true);

      if (productsError) throw productsError;

      const alerts: StockAlert[] = [];

      for (const product of products || []) {
        const stock = (product.finished_goods as any)?.[0]?.stock || 0;
        const minStock = product.min_stock || 10;

        if (stock === 0) {
          alerts.push({
            product_id: product.id,
            product_name: product.name,
            current_stock: stock,
            min_stock: minStock,
            severity: "critical",
          });
        } else if (stock <= minStock) {
          alerts.push({
            product_id: product.id,
            product_name: product.name,
            current_stock: stock,
            min_stock: minStock,
            severity: "warning",
          });
        }
      }

      return alerts;
    } catch (error) {
      console.error("[Notifications] Check stock failed:", error);
      return [];
    }
  }

  // Send stock alert notifications
  async sendStockAlerts(): Promise<void> {
    const alerts = await this.checkStockAlerts();

    if (alerts.length === 0) {
      console.log("[Notifications] All stock levels OK");
      return;
    }

    // Group by severity
    const critical = alerts.filter((a) => a.severity === "critical");
    const warnings = alerts.filter((a) => a.severity === "warning");

    // Send critical alerts
    if (critical.length > 0) {
      const productNames = critical.map((a) => a.product_name).join(", ");
      await this.sendNotification({
        title: `🚨 Stok Habis! (${critical.length} produk)`,
        body: `${productNames} - Segera restok!`,
        tag: "stock-critical",
        data: { type: "stock-critical", products: critical },
      });
    }

    // Send warnings
    if (warnings.length > 0) {
      const productNames = warnings.map((a) => `${a.product_name} (${a.current_stock})`).join(", ");
      await this.sendNotification({
        title: `⚠️ Stok Menipis (${warnings.length} produk)`,
        body: productNames,
        tag: "stock-warning",
        data: { type: "stock-warning", products: warnings },
      });
    }

    // Store alerts in Supabase for admin dashboard
    const { error: insertError } = await supabase.from("stock_alerts").insert(
      alerts.map((alert) => ({
        product_id: alert.product_id,
        severity: alert.severity,
        message: `${alert.product_name}: ${alert.current_stock}/${alert.min_stock}`,
        created_at: new Date().toISOString(),
      }))
    );

    if (insertError) {
      console.error("[Notifications] Failed to store alerts:", insertError);
    }
  }

  // Send new order notification
  async sendNewOrderNotification(orderId: string, total: number, items: string[]): Promise<void> {
    await this.sendNotification({
      title: "🛒 Pesanan Baru",
      body: `Order #${orderId.slice(0, 8)} - Rp ${total.toLocaleString("id-ID")}\n${items.slice(0, 3).join(", ")}${items.length > 3 ? ` +${items.length - 3} lainnya` : ""}`,
      tag: `order-${orderId}`,
      data: { type: "new-order", orderId, total },
    });
  }

  // Send payment notification
  async sendPaymentNotification(amount: number, method: string): Promise<void> {
    await this.sendNotification({
      title: "💰 Pembayaran Diterima",
      body: `Rp ${amount.toLocaleString("id-ID")} via ${method === "cash" ? "Tunai" : "QRIS"}`,
      tag: "payment-received",
      data: { type: "payment", amount, method },
    });
  }

  // Start periodic stock check (every 5 minutes)
  startStockMonitoring(intervalMs: number = 5 * 60 * 1000): () => void {
    console.log(`[Notifications] Starting stock monitoring (every ${intervalMs / 1000}s)`);

    // Initial check
    this.sendStockAlerts();

    // Periodic check
    const interval = setInterval(() => {
      this.sendStockAlerts();
    }, intervalMs);

    // Cleanup function
    return () => {
      console.log("[Notifications] Stopping stock monitoring");
      clearInterval(interval);
    };
  }

  // Get notification permission status
  getPermissionStatus(): {
    supported: boolean;
    permission: NotificationPermission;
    canNotify: boolean;
  } {
    return {
      supported: this.isSupported,
      permission: this.permission,
      canNotify: this.isSupported && this.permission === "granted",
    };
  }
}

// Singleton instance
export const notifications = new NotificationManager();

// React hook for notifications
export function useNotifications() {
  return {
    requestPermission: () => notifications.requestPermission(),
    sendNotification: (payload: NotificationPayload) => notifications.sendNotification(payload),
    checkStockAlerts: () => notifications.checkStockAlerts(),
    startStockMonitoring: (intervalMs?: number) => notifications.startStockMonitoring(intervalMs),
    getPermissionStatus: () => notifications.getPermissionStatus(),
  };
}
