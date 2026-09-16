import { useCartStore } from "@/stores/cartStore";

// Reset store before each test
beforeEach(() => {
  useCartStore.setState({
    items: [],
    serviceMode: "take_away",
    selectedTable: null,
  });
});

describe("Cart Store", () => {
  const mockProduct = {
    id: "1",
    name: "Ayam Reguler",
    price: 18000,
    hpp: 12000,
    image: "/images/ayam.jpg",
    category_id: "cat1",
    is_active: true,
    min_stock: 10,
  };

  it("adds item to cart", () => {
    const { addItem } = useCartStore.getState();
    addItem(mockProduct);

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe("1");
    expect(items[0].quantity).toBe(1);
  });

  it("increments quantity when adding same item", () => {
    const { addItem } = useCartStore.getState();
    addItem(mockProduct);
    addItem(mockProduct);

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });

  it("removes item from cart", () => {
    const { addItem, removeItem } = useCartStore.getState();
    addItem(mockProduct);
    removeItem("1");

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(0);
  });

  it("updates quantity", () => {
    const { addItem, updateQuantity } = useCartStore.getState();
    addItem(mockProduct);
    updateQuantity("1", 5);

    const { items } = useCartStore.getState();
    expect(items[0].quantity).toBe(5);
  });

  it("removes item when quantity is 0", () => {
    const { addItem, updateQuantity } = useCartStore.getState();
    addItem(mockProduct);
    updateQuantity("1", 0);

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(0);
  });

  it("clears cart", () => {
    const { addItem, clearCart } = useCartStore.getState();
    addItem(mockProduct);
    addItem({ ...mockProduct, id: "2", name: "Nasi Putih" });
    clearCart();

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(0);
  });

  it("calculates subtotal correctly", () => {
    const { addItem } = useCartStore.getState();
    addItem(mockProduct);
    addItem(mockProduct);

    const { getSubtotal } = useCartStore.getState();
    expect(getSubtotal()).toBe(36000); // 18000 * 2
  });

  it("calculates total HPP correctly", () => {
    const { addItem } = useCartStore.getState();
    addItem(mockProduct);
    addItem(mockProduct);

    const { getTotalHPP } = useCartStore.getState();
    expect(getTotalHPP()).toBe(24000); // 12000 * 2
  });

  it("sets service mode", () => {
    const { setServiceMode } = useCartStore.getState();
    setServiceMode("dine_in");

    const { serviceMode } = useCartStore.getState();
    expect(serviceMode).toBe("dine_in");
  });

  it("sets selected table", () => {
    const { setSelectedTable } = useCartStore.getState();
    setSelectedTable("5");

    const { selectedTable } = useCartStore.getState();
    expect(selectedTable).toBe("5");
  });

  it("counts items correctly", () => {
    const { addItem } = useCartStore.getState();
    addItem(mockProduct);
    addItem(mockProduct);
    addItem({ ...mockProduct, id: "2", name: "Nasi Putih" });

    const { getItemCount } = useCartStore.getState();
    expect(getItemCount()).toBe(3); // 2 + 1
  });
});
