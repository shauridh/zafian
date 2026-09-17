"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const ADMIN = { id: "1", name: "Sabana", pin: "080802" };

export default function LoginPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handlePinPress = (digit: string) => {
    setError("");
    if (digit === "backspace") {
      setPin(pin.slice(0, -1));
      return;
    }
    if (pin.length >= 6) return;
    const newPin = pin + digit;
    setPin(newPin);

    // Auto-submit when 6 digits entered
    if (newPin.length === 6) {
      setLoading(true);
      setTimeout(() => {
        if (newPin === ADMIN.pin) {
          // Store login state
          localStorage.setItem("sabana-admin", JSON.stringify({ name: ADMIN.name, loggedIn: true }));
          router.push("/kasir");
        } else {
          setError("PIN salah! Coba lagi.");
          setPin("");
          setLoading(false);
        }
      }, 300);
    }
  };

  return (
    <div className="min-h-screen bg-cream dark:bg-[#0f0f0f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-24 h-24 mx-auto bg-gradient-to-br from-sabana to-sabana-dark rounded-3xl flex items-center justify-center text-5xl mb-4 shadow-xl shadow-sabana/30">
            🍗
          </div>
          <h1 className="font-heading font-extrabold text-3xl text-sabana">SABANA</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Fried Chicken POS</p>
        </div>

        {/* Time Display */}
        <div className="text-center mb-6">
          <p className="text-3xl font-mono font-bold text-gray-800 dark:text-gray-200">
            {currentTime.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {currentTime.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>

        {/* PIN Input */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-3xl p-6 border border-gray-200 dark:border-[#333] shadow-xl">
          <h2 className="font-heading font-semibold text-gray-900 dark:text-gray-100 mb-1 text-center">
            Masukkan PIN
          </h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center mb-6">
            6 digit PIN admin
          </p>

          {/* PIN Dots */}
          <div className="flex justify-center gap-3 mb-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full transition-all duration-200 ${
                  i < pin.length ? "bg-sabana scale-125 shadow-lg shadow-sabana/30" : "bg-gray-200 dark:bg-[#444]"
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="text-center text-danger text-sm mb-4 font-medium animate-pulse">{error}</p>
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
                    disabled={loading}
                    className={`h-16 rounded-2xl text-2xl font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                      digit === "backspace"
                        ? "bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#444]"
                        : "bg-gray-50 dark:bg-[#262626] text-gray-900 dark:text-gray-100 hover:bg-sabana-50 dark:hover:bg-sabana/10 border border-gray-200 dark:border-[#333] hover:border-sabana"
                    }`}
                  >
                    {digit === "backspace" ? "⌫" : digit}
                  </button>
                );
              }
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <div className="w-4 h-4 border-2 border-sabana border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-500">Verifikasi...</span>
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="flex justify-center gap-3 mt-6">
          <button
            onClick={() => router.push("/order")}
            className="text-xs px-4 py-2 rounded-xl bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#333] text-gray-600 dark:text-gray-400 hover:border-sabana hover:text-sabana transition-all"
          >
            🛒 Order Online
          </button>
          <button
            onClick={() => router.push("/customer")}
            className="text-xs px-4 py-2 rounded-xl bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#333] text-gray-600 dark:text-gray-400 hover:border-sabana hover:text-sabana transition-all"
          >
            👤 Customer Portal
          </button>
        </div>
      </div>
    </div>
  );
}
