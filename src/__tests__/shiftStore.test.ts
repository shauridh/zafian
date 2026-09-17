import { useShiftStore } from "@/stores/shiftStore";

// Reset store before each test
beforeEach(() => {
  useShiftStore.setState({
    isShiftOpen: false,
    shiftId: null,
    cashierId: null,
    cashierName: "",
    openingFloat: 350000,
    openedAt: null,
  });
});

describe("Shift Store", () => {
  it("opens shift", () => {
    const { openShift } = useShiftStore.getState();
    openShift("user-456", "Ahmad", 350000, "shift-123");

    const state = useShiftStore.getState();
    expect(state.shiftId).toBe("shift-123");
    expect(state.cashierId).toBe("user-456");
    expect(state.cashierName).toBe("Ahmad");
    expect(state.openingFloat).toBe(350000);
    expect(state.isShiftOpen).toBe(true);
    expect(state.openedAt).toBeTruthy();
  });

  it("generates local shift id when supabase id omitted", () => {
    const { openShift } = useShiftStore.getState();
    openShift("user-456", "Ahmad", 350000);

    const state = useShiftStore.getState();
    expect(state.shiftId).toMatch(/^SH-\d+$/);
  });

  it("closes shift", () => {
    const { openShift, closeShift } = useShiftStore.getState();
    openShift("user-456", "Ahmad", 350000);
    closeShift();

    const state = useShiftStore.getState();
    expect(state.shiftId).toBeNull();
    expect(state.cashierId).toBeNull();
    expect(state.cashierName).toBe("");
    expect(state.isShiftOpen).toBe(false);
    expect(state.openedAt).toBeNull();
  });

  it("gets current shift", () => {
    const { openShift, getCurrentShift } = useShiftStore.getState();
    expect(getCurrentShift().isShiftOpen).toBe(false);

    openShift("user-456", "Ahmad", 350000);
    const shift = getCurrentShift();
    expect(shift.isShiftOpen).toBe(true);
    expect(shift.cashierName).toBe("Ahmad");
    expect(shift.openingFloat).toBe(350000);
  });
});
