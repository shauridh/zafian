"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Theme = "light" | "dark" | "system";

type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
};

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  setTheme: () => {},
  resolvedTheme: "light",
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  // Load saved theme
  useEffect(() => {
    const saved = localStorage.getItem("sabana-theme") as Theme;
    if (saved) {
      setTheme(saved);
    }
  }, []);

  // Resolve theme based on system preference
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    
    const updateResolvedTheme = () => {
      if (theme === "system") {
        setResolvedTheme(mediaQuery.matches ? "dark" : "light");
      } else {
        setResolvedTheme(theme);
      }
    };

    updateResolvedTheme();
    mediaQuery.addEventListener("change", updateResolvedTheme);
    
    return () => mediaQuery.removeEventListener("change", updateResolvedTheme);
  }, [theme]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    
    // Update meta theme color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#1a1a1a" : "#e86d3d"
      );
    }
  }, [resolvedTheme]);

  // Save theme preference
  const handleSetTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem("sabana-theme", newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
