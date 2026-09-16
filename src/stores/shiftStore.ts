import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ShiftState {
  isShiftOpen: boolean;
  shiftId: string | null;
  cashierId: string | null;
  cashierName: string;
  openingFloat: number;
  openedAt: string | null;

  // Actions
  openShift: (cashierId: string, cashierName: string, float: number, supabaseShiftId?: string) => void;
  closeShift: () => void;
  getCurrentShift: () => {
    isShiftOpen: boolean;
    shiftId: string | null;
    cashierId: string | null;
    cashierName: string;
    openingFloat: number;
    openedAt: string | null;
  };
}

export const useShiftStore = create<ShiftState>()(
  persist(
    (set, get) => ({
      isShiftOpen: false,
      shiftId: null,
      cashierId: null,
      cashierName: "",
      openingFloat: 350000,
      openedAt: null,

      openShift: (cashierId, cashierName, float, supabaseShiftId) => {
        const localId = supabaseShiftId || `SH-${Date.now()}`;
        set({
          isShiftOpen: true,
          shiftId: localId,
          cashierId,
          cashierName,
          openingFloat: float,
          openedAt: new Date().toISOString(),
        });
      },

      closeShift: () => {
        set({
          isShiftOpen: false,
          shiftId: null,
          cashierId: null,
          cashierName: "",
          openingFloat: 350000,
          openedAt: null,
        });
      },

      getCurrentShift: () => {
        const state = get();
        return {
          isShiftOpen: state.isShiftOpen,
          shiftId: state.shiftId,
          cashierId: state.cashierId,
          cashierName: state.cashierName,
          openingFloat: state.openingFloat,
          openedAt: state.openedAt,
        };
      },
    }),
    {
      name: "sabana-shift-store", // localStorage key
    }
  )
);
