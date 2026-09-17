import { useCartStore } from "@/stores/cartStore";

// Reset store before each test
beforeEach(() => {
  useCartStore.setState({
    items: [],
    serviceMode: "dine_in",
    discount: 0,
    discountType: "fixed",
  });
});

const mockProduct = {
  id: "1",
  product_id: "1",
  name: "Ayam Reguler",
  price: 18000,
  image_url: "/images/ayam.jpg",
};

describe("Cart Store", () => {
  it("adds item to cart", () => {
    const { addItem } = useCartStore.getState();
    addItem(mockProduct);

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("1");
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

  it("removes item", () => {
    const { addItem, removeItem } = useCartStore.getState();
    addItem(mockProduct);
    removeItem("1");

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(0);
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
    addItem({ ...mockProduct, id: "2", product_id: "2", name: "Nasi Putih" });
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

  it("calculates total with fixed discount", () => {
    const { addItem, setDiscount } = useCartStore.getState();
    addItem(mockProduct);
    addItem(mockProduct);
    setDiscount(6000, "fixed");

    const { getTotal } = useCartStore.getState();
    expect(getTotal()).toBe(30000); // 36000 - 6000
  });

  it("calculates total with percentage discount", () => {
    const { addItem, setDiscount } = useCartStore.getState();
    addItem(mockProduct);
    addItem(mockProduct);
    setDiscount(50, "percentage");

    const { getTotal } = useCartStore.getState();
    expect(getTotal()).toBe(18000); // 36000 * 50%
  });

  it("sets service mode", () => {
    const { setServiceMode } = useCartStore.getState();
    setServiceMode("dine_in");

    const { serviceMode } = useCartStore.getState();
    expect(serviceMode).toBe("dine_in");
  });

  it("counts items correctly", () => {
    const { addItem } = useCartStore.getState();
    addItem(mockProduct);
    addItem(mockProduct);
    addItem({ ...mockProduct, id: "2", product_id: "2", name: "Nasi Putih" });

    const { getItemCount } = useCartStore.getState();
    expect(getItemCount()).toBe(3);
  });
});
