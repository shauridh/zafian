"use client";

import { useState, useRef } from "react";
import { backup } from "@/lib/backup";

export default function BackupSettings() {
  const [backups, setBackups] = useState(backup.getBackupList());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const backupData = await backup.exportAll();
      await backup.downloadBackup(backupData);
      setBackups(backup.getBackupList());
    } catch (error) {
      console.error("Export failed:", error);
      alert("Gagal export backup");
    } finally {
      setExporting(false);
    }
  };

  const handleExportCSV = async (table: string) => {
    try {
      await backup.exportCSV(table);
    } catch (error) {
      console.error("CSV export failed:", error);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      const result = await backup.importBackup(file);
      setImportResult(result);
      if (result.success) {
        setBackups(backup.getBackupList());
      }
    } catch (error) {
      console.error("Import failed:", error);
      setImportResult({ success: false, message: "Gagal import backup" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleAutoBackup = async () => {
    const success = await backup.autoBackup();
    if (success) {
      setBackups(backup.getBackupList());
      alert("Auto backup berhasil!");
    } else {
      alert("Auto backup gagal");
    }
  };

  const handleDeleteBackup = (id: string) => {
    if (confirm("Hapus backup ini?")) {
      backup.deleteBackupMetadata(id);
      setBackups(backup.getBackupList());
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm mb-4">
      <h3 className="font-heading font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-sabana-100 flex items-center justify-center text-sm">💾</span>
        Backup & Restore
      </h3>

      {/* Export Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-50 rounded-xl p-4">
          <h4 className="font-medium text-gray-800 mb-2">Export Full Backup</h4>
          <p className="text-sm text-gray-500 mb-3">
            Export semua data ke file JSON. Bisa di-import kembali kapan saja.
          </p>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="w-full px-4 py-2 bg-sabana text-white rounded-lg font-medium hover:bg-sabana-dark transition-colors disabled:opacity-50"
          >
            {exporting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Exporting...
              </span>
            ) : (
              "📥 Download JSON Backup"
            )}
          </button>
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <h4 className="font-medium text-gray-800 mb-2">Import Backup</h4>
          <p className="text-sm text-gray-500 mb-3">
            Restore data dari file backup JSON sebelumnya.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {importing ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Importing...
              </span>
            ) : (
              "📤 Upload JSON Backup"
            )}
          </button>
        </div>
      </div>

      {/* Import Result */}
      {importResult && (
        <div className={`p-3 rounded-lg mb-4 ${importResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          <p className={`text-sm font-medium ${importResult.success ? "text-green-700" : "text-red-700"}`}>
            {importResult.success ? "✅" : "❌"} {importResult.message}
          </p>
        </div>
      )}

      {/* Quick CSV Export */}
      <div className="mb-4">
        <h4 className="font-medium text-gray-800 mb-2">Quick CSV Export</h4>
        <div className="flex flex-wrap gap-2">
          {["products", "orders", "shifts", "customers", "stock_ledger"].map((table) => (
            <button
              key={table}
              onClick={() => handleExportCSV(table)}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
            >
              📊 {table}
            </button>
          ))}
        </div>
      </div>

      {/* Auto Backup */}
      <div className="bg-blue-50 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-blue-800">Auto Backup</h4>
            <p className="text-sm text-blue-600">
              Backup otomatis setiap 24 jam (tersimpan lokal)
            </p>
          </div>
          <button
            onClick={handleAutoBackup}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
          >
            🔄 Backup Sekarang
          </button>
        </div>
      </div>

      {/* Backup History */}
      <div>
        <h4 className="font-medium text-gray-800 mb-2">Riwayat Backup ({backups.length})</h4>
        {backups.length === 0 ? (
          <p className="text-sm text-gray-500">Belum ada backup</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {backups.map((b) => (
              <div key={b.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{b.name}</p>
                  <p className="text-xs text-gray-500">
                    {formatDate(b.created_at)} • {b.record_count} records • {backup.formatFileSize(b.file_size)}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    b.type === "scheduled" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"
                  }`}>
                    {b.type === "scheduled" ? "Auto" : "Manual"}
                  </span>
                  <button
                    onClick={() => handleDeleteBackup(b.id)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    title="Hapus"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
