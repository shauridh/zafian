import { useShiftStore } from "@/stores/shiftStore";

// Reset store before each test
beforeEach(() => {
  useShiftStore.setState({
    shiftId: null,
    userId: null,
    userName: null,
    float: 0,
    isOpen: false,
    openedAt: null,
  });
});

describe("Shift Store", () => {
  it("opens shift", () => {
    const { openShift } = useShiftStore.getState();
    openShift("shift-123", "user-456", "Ahmad", 350000);

    const state = useShiftStore.getState();
    expect(state.shiftId).toBe("shift-123");
    expect(state.userId).toBe("user-456");
    expect(state.userName).toBe("Ahmad");
    expect(state.float).toBe(350000);
    expect(state.isOpen).toBe(true);
    expect(state.openedAt).toBeTruthy();
  });

  it("closes shift", () => {
    const { openShift, closeShift } = useShiftStore.getState();
    openShift("shift-123", "user-456", "Ahmad", 350000);
    closeShift();

    const state = useShiftStore.getState();
    expect(state.shiftId).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.userName).toBeNull();
    expect(state.float).toBe(0);
    expect(state.isOpen).toBe(false);
    expect(state.openedAt).toBeNull();
  });

  it("checks if shift is open", () => {
    const { openShift, isShiftOpen } = useShiftStore.getState();
    expect(isShiftOpen()).toBe(false);

    openShift("shift-123", "user-456", "Ahmad", 350000);
    expect(isShiftOpen()).toBe(true);
  });

  it("gets current user info", () => {
    const { openShift, getCurrentUser } = useShiftStore.getState();
    openShift("shift-123", "user-456", "Ahmad", 350000);

    const user = getCurrentUser();
    expect(user).toEqual({
      userId: "user-456",
      userName: "Ahmad",
    });
  });

  it("returns null when no user", () => {
    const { getCurrentUser } = useShiftStore.getState();
    const user = getCurrentUser();
    expect(user).toBeNull();
  });

  it("gets shift info", () => {
    const { openShift, getShiftInfo } = useShiftStore.getState();
    openShift("shift-123", "user-456", "Ahmad", 350000);

    const info = getShiftInfo();
    expect(info).toEqual({
      shiftId: "shift-123",
      float: 350000,
      openedAt: expect.any(String),
    });
  });

  it("returns null shift info when closed", () => {
    const { getShiftInfo } = useShiftStore.getState();
    const info = getShiftInfo();
    expect(info).toBeNull();
  });
});
