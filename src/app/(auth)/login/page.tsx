"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

const MOCK_CASHIERS = [
  { id: "1", name: "Ahmad", avatar: "A" },
  { id: "2", name: "Rina", avatar: "R" },
  { id: "3", name: "Budi", avatar: "B" },
  { id: "4", name: "Sari", avatar: "S" },
];

export default function LoginPage() {
  const router = useRouter();
  const [selectedCashier, setSelectedCashier] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handlePinPress = (digit: string) => {
    setError("");
    if (digit === "backspace") {
      setPin(pin.slice(0, -1));
      return;
    }
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);

    // Auto-submit when 4 digits entered
    if (newPin.length === 4) {
      // For demo, any 4-digit PIN works
      setTimeout(() => {
        router.push("/kasir");
      }, 300);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto bg-sabana rounded-2xl flex items-center justify-center text-4xl mb-4 shadow-lg shadow-sabana/30">
            🍗
          </div>
          <h1 className="font-heading font-bold text-3xl text-sabana">SABANA</h1>
          <p className="text-gray-500 mt-1">Fried Chicken POS</p>
        </div>

        {/* Cashier Selection */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm mb-4">
          <h2 className="font-heading font-semibold text-gray-900 mb-4">Pilih Kasir</h2>
          <div className="grid grid-cols-2 gap-3">
            {MOCK_CASHIERS.map((cashier) => (
              <button
                key={cashier.id}
                onClick={() => setSelectedCashier(cashier.id)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  selectedCashier === cashier.id
                    ? "border-sabana bg-sabana-50 shadow-md"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white ${
                    selectedCashier === cashier.id ? "bg-sabana" : "bg-gray-300"
                  }`}
                >
                  {cashier.avatar}
                </div>
                <span className="font-medium text-sm">{cashier.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* PIN Input */}
        {selectedCashier && (
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <h2 className="font-heading font-semibold text-gray-900 mb-4 text-center">
              Masukkan PIN
            </h2>

            {/* PIN Dots */}
            <div className="flex justify-center gap-3 mb-6">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full transition-all ${
                    i < pin.length ? "bg-sabana scale-125" : "bg-gray-200"
                  }`}
                />
              ))}
            </div>

            {error && (
              <p className="text-center text-danger text-sm mb-4">{error}</p>
            )}

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"].map(
                (digit, idx) => {
                  if (digit === "") return <div key={idx} />;
                  return (
                    <button
                      key={idx}
                      onClick={() => handlePinPress(digit)}
                      className={`h-16 rounded-xl text-2xl font-semibold transition-all active:scale-95 ${
                        digit === "backspace"
                          ? "bg-gray-100 text-gray-600"
                          : "bg-gray-50 text-gray-900 hover:bg-sabana-50 border border-gray-200"
                      }`}
                    >
                      {digit === "backspace" ? "⌫" : digit}
                    </button>
                  );
                }
              )}
            </div>
          </div>
        )}

        {/* Links */}
        <div className="flex justify-center gap-4 mt-6">
          <button
            onClick={() => router.push("/kasir/shift/open")}
            className="text-sm px-4 py-2 rounded-xl bg-sabana text-white font-semibold hover:bg-sabana-dark transition-colors shadow-md"
          >
            🟢 Buka Kasir
          </button>
          <button
            onClick={() => router.push("/order")}
            className="text-sm text-gray-500 hover:text-sabana transition-colors"
          >
            🛒 Customer Portal
          </button>
          <button
            onClick={() => router.push("/admin/dashboard")}
            className="text-sm text-gray-500 hover:text-sabana transition-colors"
          >
            📊 Admin
          </button>
        </div>
      </div>
    </div>
  );
}
