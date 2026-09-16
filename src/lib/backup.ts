// Database Backup System for Sabana POS
// Handles export, import, and scheduled backups of Supabase data

import { supabase } from "./supabase";

type BackupMetadata = {
  id: string;
  name: string;
  created_at: string;
  tables: string[];
  record_count: number;
  file_size: number;
  status: "completed" | "failed" | "in_progress";
  type: "manual" | "scheduled";
};

type BackupData = {
  metadata: BackupMetadata;
  data: Record<string, any[]>;
};

class BackupManager {
  private storageKey = "sabana-backups";

  // Export all data from Supabase
  async exportAll(tables?: string[]): Promise<BackupData> {
    const tablesToExport = tables || [
      "outlets",
      "users",
      "categories",
      "products",
      "ingredients",
      "product_ingredients",
      "bundles",
      "finished_goods",
      "stock_ledger",
      "shifts",
      "orders",
      "order_items",
      "customers",
      "loyalty_transactions",
      "promos",
      "daily_reconciliation",
    ];

    const data: Record<string, any[]> = {};
    let totalRecords = 0;

    for (const table of tablesToExport) {
      try {
        const { data: tableData, error } = await supabase
          .from(table)
          .select("*");

        if (error) {
          console.warn(`[Backup] Failed to export ${table}:`, error.message);
          data[table] = [];
        } else {
          data[table] = tableData || [];
          totalRecords += (tableData || []).length;
        }
      } catch (err) {
        console.warn(`[Backup] Error exporting ${table}:`, err);
        data[table] = [];
      }
    }

    const metadata: BackupMetadata = {
      id: `backup-${Date.now()}`,
      name: `Backup ${new Date().toLocaleDateString("id-ID")}`,
      created_at: new Date().toISOString(),
      tables: tablesToExport,
      record_count: totalRecords,
      file_size: 0, // Will be calculated after serialization
      status: "completed",
      type: "manual",
    };

    const backup: BackupData = { metadata, data };

    // Calculate file size
    const jsonString = JSON.stringify(backup);
    metadata.file_size = new Blob([jsonString]).size;

    return backup;
  }

  // Export specific tables only
  async exportTables(tables: string[]): Promise<BackupData> {
    return this.exportAll(tables);
  }

  // Download backup as JSON file
  async downloadBackup(backup: BackupData): Promise<void> {
    const jsonString = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `sabana-backup-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);

    // Save backup metadata locally
    this.saveBackupMetadata(backup.metadata);
  }

  // Import backup from JSON file
  async importBackup(file: File): Promise<{ success: boolean; message: string; imported: number }> {
    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const backup: BackupData = JSON.parse(e.target?.result as string);

          if (!backup.metadata || !backup.data) {
            resolve({ success: false, message: "File backup tidak valid", imported: 0 });
            return;
          }

          let imported = 0;

          for (const [table, records] of Object.entries(backup.data)) {
            if (records.length === 0) continue;

            try {
              // Delete existing data (optional, based on user choice)
              // await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");

              // Insert new data
              const { error } = await supabase.from(table).upsert(records, {
                onConflict: "id",
                ignoreDuplicates: false,
              });

              if (error) {
                console.warn(`[Backup] Failed to import ${table}:`, error.message);
              } else {
                imported += records.length;
              }
            } catch (err) {
              console.warn(`[Backup] Error importing ${table}:`, err);
            }
          }

          resolve({
            success: true,
            message: `Berhasil import ${imported} records dari ${Object.keys(backup.data).length} tabel`,
            imported,
          });
        } catch (error) {
          resolve({ success: false, message: "Gagal membaca file backup", imported: 0 });
        }
      };

      reader.onerror = () => {
        resolve({ success: false, message: "Gagal membaca file", imported: 0 });
      };

      reader.readAsText(file);
    });
  }

  // Export to CSV format
  async exportCSV(table: string): Promise<void> {
    const { data, error } = await supabase.from(table).select("*");

    if (error) {
      console.error(`[Backup] Failed to export ${table}:`, error);
      return;
    }

    if (!data || data.length === 0) {
      console.warn(`[Backup] No data in ${table}`);
      return;
    }

    // Convert to CSV
    const headers = Object.keys(data[0]);
    const rows = data.map((row) =>
      headers.map((h) => {
        const value = row[h];
        // Escape quotes and wrap in quotes if contains comma or newline
        if (typeof value === "string" && (value.includes(",") || value.includes("\n"))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value ?? "";
      }).join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `sabana-${table}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  // Save backup metadata to localStorage
  private saveBackupMetadata(metadata: BackupMetadata): void {
    const backups = this.getBackupList();
    backups.unshift(metadata);

    // Keep only last 10 backups
    if (backups.length > 10) {
      backups.splice(10);
    }

    localStorage.setItem(this.storageKey, JSON.stringify(backups));
  }

  // Get list of backups
  getBackupList(): BackupMetadata[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  // Delete backup metadata
  deleteBackupMetadata(id: string): void {
    const backups = this.getBackupList().filter((b) => b.id !== id);
    localStorage.setItem(this.storageKey, JSON.stringify(backups));
  }

  // Auto-backup (scheduled)
  async autoBackup(): Promise<boolean> {
    try {
      const backup = await this.exportAll();
      backup.metadata.type = "scheduled";
      backup.metadata.name = `Auto Backup ${new Date().toLocaleString("id-ID")}`;

      // Store in localStorage (in production, you'd upload to cloud storage)
      this.saveBackupMetadata(backup.metadata);

      console.log(`[Backup] Auto backup completed: ${backup.metadata.record_count} records`);
      return true;
    } catch (error) {
      console.error("[Backup] Auto backup failed:", error);
      return false;
    }
  }

  // Start auto-backup scheduler (every 24 hours)
  startAutoBackup(intervalMs: number = 24 * 60 * 60 * 1000): () => void {
    console.log(`[Backup] Starting auto-backup (every ${intervalMs / 1000 / 60 / 60}h)`);

    // Run immediately
    this.autoBackup();

    // Schedule periodic backups
    const interval = setInterval(() => {
      this.autoBackup();
    }, intervalMs);

    // Cleanup function
    return () => {
      console.log("[Backup] Stopping auto-backup");
      clearInterval(interval);
    };
  }

  // Format file size
  formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}

// Singleton instance
export const backup = new BackupManager();

// React hook for backup
export function useBackup() {
  return {
    exportAll: (tables?: string[]) => backup.exportAll(tables),
    exportTables: (tables: string[]) => backup.exportTables(tables),
    downloadBackup: (backupData: BackupData) => backup.downloadBackup(backupData),
    importBackup: (file: File) => backup.importBackup(file),
    exportCSV: (table: string) => backup.exportCSV(table),
    getBackupList: () => backup.getBackupList(),
    deleteBackupMetadata: (id: string) => backup.deleteBackupMetadata(id),
    autoBackup: () => backup.autoBackup(),
    startAutoBackup: (intervalMs?: number) => backup.startAutoBackup(intervalMs),
    formatFileSize: (bytes: number) => backup.formatFileSize(bytes),
  };
}
