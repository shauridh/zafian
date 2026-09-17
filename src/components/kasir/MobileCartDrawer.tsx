"use client";

import Cart from "@/components/kasir/Cart";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCheckout: () => void;
}

/** Mobile/tablet portrait cart drawer (lg:hidden) — slides in from the right. */
export default function MobileCartDrawer({ isOpen, onClose, onCheckout }: Props) {
  if (!isOpen) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-30">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-[320px] sm:w-[340px] max-w-[85vw]">
        <Cart onCheckout={() => { onClose(); onCheckout(); }} />
      </div>
    </div>
  );
}
