"use client";

const STEPS = ["pending", "confirmed", "preparing", "delivering", "completed"] as const;
const LABELS: Record<string, string> = { pending: "Diterima", confirmed: "Dikonfirmasi", preparing: "Disiapkan", delivering: "Diantar", completed: "Selesai" };

export default function OrderStatusTimeline({ status }: { status: string }) {
  const current = Math.max(0, STEPS.indexOf(status as typeof STEPS[number]));
  return <div className="mt-3 grid grid-cols-5 gap-1" aria-label={`Status order: ${LABELS[status] || status}`}>
    {STEPS.map((step, index) => <div key={step} className="text-center"><div className={`mx-auto h-2 w-2 rounded-full ${index <= current ? "bg-sabana" : "bg-gray-200"}`} /><p className={`mt-1 text-[8px] leading-tight ${index <= current ? "font-semibold text-sabana" : "text-gray-400"}`}>{LABELS[step]}</p></div>)}
  </div>;
}
