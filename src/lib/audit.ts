// Audit Log System for Sabana POS
// Tracks all data changes with who, when, what, and before/after values

import { supabase } from "./supabase/client";

type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "PAYMENT" | "SHIFT_OPEN" | "SHIFT_CLOSE";

type AuditEntity = "product" | "category" | "order" | "shift" | "user" | "customer" | "promo" | "stock" | "settings";

type AuditLogEntry = {
  id?: string;
  action: AuditAction;
  entity: AuditEntity;
  entity_id?: string;
  entity_name?: string;
  user_id?: string;
  user_name?: string;
  before?: any;
  after?: any;
  metadata?: any;
  ip_address?: string;
  created_at?: string;
};

class AuditLogger {
  private buffer: AuditLogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private isOnline: boolean = true;

  constructor() {
    // Check online status
    if (typeof window !== "undefined") {
      this.isOnline = navigator.onLine;
      window.addEventListener("online", () => {
        this.isOnline = true;
        this.flush();
      });
      window.addEventListener("offline", () => {
        this.isOnline = false;
      });
    }
  }

  // Log an audit entry
  async log(entry: AuditLogEntry): Promise<void> {
    const fullEntry: AuditLogEntry = {
      ...entry,
      created_at: new Date().toISOString(),
      ip_address: await this.getClientIP(),
    };

    // Add to buffer
    this.buffer.push(fullEntry);

    // Flush if online and buffer is large enough
    if (this.isOnline && this.buffer.length >= 10) {
      await this.flush();
    }

    // Also log to console for debugging
    console.log(`[Audit] ${entry.action} ${entry.entity}:`, {
      id: entry.entity_id,
      name: entry.entity_name,
      user: entry.user_name,
    });
  }

  // Flush buffer to Supabase
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.isOnline) return;

    try {
      const entriesToFlush = [...this.buffer];
      this.buffer = [];

      const { error } = await supabase.from("audit_logs").insert(entriesToFlush);

      if (error) {
        console.error("[Audit] Failed to flush logs:", error);
        // Re-add failed entries to buffer
        this.buffer = [...entriesToFlush, ...this.buffer];
      } else {
        console.log(`[Audit] Flushed ${entriesToFlush.length} entries`);
      }
    } catch (error) {
      console.error("[Audit] Flush error:", error);
    }
  }

  // Get client IP (best effort)
  private async getClientIP(): Promise<string | undefined> {
    try {
      // This is a best-effort approach
      // In production, you'd use a server-side API
      return undefined;
    } catch {
      return undefined;
    }
  }

  // Convenience methods for common actions

  async logCreate(entity: AuditEntity, entityId: string, entityName: string, after: any, userId?: string, userName?: string): Promise<void> {
    await this.log({
      action: "CREATE",
      entity,
      entity_id: entityId,
      entity_name: entityName,
      after,
      user_id: userId,
      user_name: userName,
    });
  }

  async logUpdate(entity: AuditEntity, entityId: string, entityName: string, before: any, after: any, userId?: string, userName?: string): Promise<void> {
    await this.log({
      action: "UPDATE",
      entity,
      entity_id: entityId,
      entity_name: entityName,
      before,
      after,
      user_id: userId,
      user_name: userName,
    });
  }

  async logDelete(entity: AuditEntity, entityId: string, entityName: string, before: any, userId?: string, userName?: string): Promise<void> {
    await this.log({
      action: "DELETE",
      entity,
      entity_id: entityId,
      entity_name: entityName,
      before,
      user_id: userId,
      user_name: userName,
    });
  }

  async logLogin(userId: string, userName: string, method: string): Promise<void> {
    await this.log({
      action: "LOGIN",
      entity: "user",
      entity_id: userId,
      entity_name: userName,
      user_id: userId,
      user_name: userName,
      metadata: { method },
    });
  }

  async logLogout(userId: string, userName: string): Promise<void> {
    await this.log({
      action: "LOGOUT",
      entity: "user",
      entity_id: userId,
      entity_name: userName,
      user_id: userId,
      user_name: userName,
    });
  }

  async logPayment(orderId: string, amount: number, method: string, userId?: string, userName?: string): Promise<void> {
    await this.log({
      action: "PAYMENT",
      entity: "order",
      entity_id: orderId,
      entity_name: `Order #${orderId.slice(0, 8)}`,
      after: { amount, method },
      user_id: userId,
      user_name: userName,
    });
  }

  async logShiftOpen(shiftId: string, float: number, userId?: string, userName?: string): Promise<void> {
    await this.log({
      action: "SHIFT_OPEN",
      entity: "shift",
      entity_id: shiftId,
      entity_name: `Shift ${userName || "Unknown"}`,
      after: { float },
      user_id: userId,
      user_name: userName,
    });
  }

  async logShiftClose(shiftId: string, summary: any, userId?: string, userName?: string): Promise<void> {
    await this.log({
      action: "SHIFT_CLOSE",
      entity: "shift",
      entity_id: shiftId,
      entity_name: `Shift ${userName || "Unknown"}`,
      after: summary,
      user_id: userId,
      user_name: userName,
    });
  }

  // Query audit logs
  async getLogs(filters?: {
    entity?: AuditEntity;
    action?: AuditAction;
    userId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: AuditLogEntry[]; count: number }> {
    try {
      let query = supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      if (filters?.entity) {
        query = query.eq("entity", filters.entity);
      }
      if (filters?.action) {
        query = query.eq("action", filters.action);
      }
      if (filters?.userId) {
        query = query.eq("user_id", filters.userId);
      }
      if (filters?.startDate) {
        query = query.gte("created_at", filters.startDate);
      }
      if (filters?.endDate) {
        query = query.lte("created_at", filters.endDate);
      }

      const { data, count, error } = await query
        .range(filters?.offset || 0, (filters?.offset || 0) + (filters?.limit || 50) - 1);

      if (error) throw error;

      return { data: data || [], count: count || 0 };
    } catch (error) {
      console.error("[Audit] Failed to fetch logs:", error);
      return { data: [], count: 0 };
    }
  }

  // Get logs for a specific entity
  async getEntityLogs(entity: AuditEntity, entityId: string): Promise<AuditLogEntry[]> {
    const { data } = await this.getLogs({
      entity,
      limit: 100,
    });

    return data.filter((log) => log.entity_id === entityId);
  }

  // Get user activity summary
  async getUserActivity(userId: string, startDate: string, endDate: string): Promise<{
    logins: number;
    logouts: number;
    orders: number;
    payments: number;
    totalAmount: number;
  }> {
    const { data } = await this.getLogs({
      userId,
      startDate,
      endDate,
      limit: 1000,
    });

    return {
      logins: data.filter((l) => l.action === "LOGIN").length,
      logouts: data.filter((l) => l.action === "LOGOUT").length,
      orders: data.filter((l) => l.action === "CREATE" && l.entity === "order").length,
      payments: data.filter((l) => l.action === "PAYMENT").length,
      totalAmount: data
        .filter((l) => l.action === "PAYMENT" && l.after?.amount)
        .reduce((sum, l) => sum + (l.after?.amount || 0), 0),
    };
  }

  // Start periodic flush (every 30 seconds)
  startPeriodicFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 30000);
  }

  // Stop periodic flush
  stopPeriodicFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }
}

// Singleton instance
export const audit = new AuditLogger();

// React hook for audit logging
export function useAudit() {
  return {
    log: (entry: AuditLogEntry) => audit.log(entry),
    logCreate: (entity: AuditEntity, entityId: string, entityName: string, after: any, userId?: string, userName?: string) =>
      audit.logCreate(entity, entityId, entityName, after, userId, userName),
    logUpdate: (entity: AuditEntity, entityId: string, entityName: string, before: any, after: any, userId?: string, userName?: string) =>
      audit.logUpdate(entity, entityId, entityName, before, after, userId, userName),
    logDelete: (entity: AuditEntity, entityId: string, entityName: string, before: any, userId?: string, userName?: string) =>
      audit.logDelete(entity, entityId, entityName, before, userId, userName),
    logLogin: (userId: string, userName: string, method: string) =>
      audit.logLogin(userId, userName, method),
    logLogout: (userId: string, userName: string) =>
      audit.logLogout(userId, userName),
    logPayment: (orderId: string, amount: number, method: string, userId?: string, userName?: string) =>
      audit.logPayment(orderId, amount, method, userId, userName),
    getLogs: (filters?: any) => audit.getLogs(filters),
    getEntityLogs: (entity: AuditEntity, entityId: string) =>
      audit.getEntityLogs(entity, entityId),
    getUserActivity: (userId: string, startDate: string, endDate: string) =>
      audit.getUserActivity(userId, startDate, endDate),
  };
}
