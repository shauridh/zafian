"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";

export default function SyncStatusBadge() {
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const orders = await db.orders.toArray();
      if (!active) return;
      setPending(orders.filter((order) => !order.synced).length);
      setFailed(orders.filter((order) => order.sync_status === "failed").length);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (!pending && !failed) return null;
  return (
    <span
      className={`hidden sm:inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${failed ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
      title={failed ? `${failed} transaksi gagal sinkron — akan dicoba lagi` : `${pending} transaksi menunggu sinkronisasi`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {failed ? `${failed} gagal` : `${pending} pending`}
    </span>
  );
}
