"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.push("/login");
  }, [router]);

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto bg-sabana rounded-2xl flex items-center justify-center text-3xl mb-4 animate-pulse">
          🍗
        </div>
        <p className="text-gray-500">Loading...</p>
      </div>
    </div>
  );
}
