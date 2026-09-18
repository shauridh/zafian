"use client";

import Cart from "@/components/kasir/Cart";
import ModalShell from "@/components/ui/ModalShell";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCheckout: () => void;
}

/** Mobile/tablet portrait cart drawer (lg:hidden) — slides in from the right. */
export default function MobileCartDrawer({ isOpen, onClose, onCheckout }: Props) {
  if (!isOpen) return null;

  return (
    <div className="lg:hidden">
      <ModalShell open={isOpen} onClose={onClose} className="h-[min(680px,calc(100vh-32px))] max-w-[420px]">
        <Cart onCheckout={() => { onClose(); onCheckout(); }} />
      </ModalShell>
    </div>
  );
}
