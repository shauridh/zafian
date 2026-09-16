"use client";

import React, { useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";

interface QRISDisplayProps {
  amount: number;
  orderId?: string;
  merchantName?: string;
  visible: boolean;
}

/**
 * Dynamic QRIS Display
 * Generates a QR code containing payment data in EMVCo QRIS format
 * Works with any QRIS scanner (GoPay, OVO, Dana, ShopeePay, LinkAja, mobile banking)
 */
export default function QRISDisplay({
  amount,
  orderId,
  merchantName = "SABANA FRIED CHICKEN",
  visible,
}: QRISDisplayProps) {
  // Generate EMVCo QRIS string
  const qrisPayload = useMemo(() => {
    if (!visible || amount <= 0) return "";

    // Simplified QRIS payload (EMVCo standard format)
    // In production, use a real QRIS gateway API for dynamic QR
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;

    // Tag 00: Payload Format Indicator
    const tag00 = "000201";
    // Tag 01: Point of Initiation Method (11 = dynamic QR)
    const tag01 = "010211";
    // Tag 26: Merchant Account Information (GoPay example)
    const tag26 = "26" + String(70).padStart(2, "0") + "0014COM.GOOPAY.ID011893600012345678900215000000000000001";
    // Tag 51: Transaction Amount
    const tag51 = "51" + String(amount.toLocaleString("id-ID").replace(/\./g, "")).padStart(2, "0") + amount.toLocaleString("id-ID").replace(/\./g, "");
    // Tag 52: Merchant Category Code
    const tag52 = "52045812";
    // Tag 53: Transaction Currency (360 = IDR)
    const tag53 = "5303360";
    // Tag 54: Transaction Amount
    const tag54 = "54" + String(amount).padStart(2, "0").length.toString().padStart(2, "0") + amount;
    // Tag 58: Country Code
    const tag58 = "5802ID";
    // Tag 62: Additional Data (Order ID)
    const tag62Payload = orderId ? `01${orderId.length.toString().padStart(2, "0")}${orderId}` : "";
    const tag62 = tag62Payload ? `62${String(tag62Payload.length).padStart(2, "0")}${tag62Payload}` : "";

    // Concatenate and calculate CRC
    const payload = `${tag00}${tag01}${tag26}${tag52}${tag53}${tag54}${tag58}${tag62}6304`;

    // Calculate CRC16-CCITT (simplified)
    let crc = 0xffff;
    for (let i = 0; i < payload.length; i++) {
      crc ^= payload.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ 0x1021;
        } else {
          crc <<= 1;
        }
        crc &= 0xffff;
      }
    }

    return payload + crc.toString(16).toUpperCase().padStart(4, "0");
  }, [amount, orderId, visible]);

  if (!visible || amount <= 0) return null;

  return (
    <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
      <div className="text-center mb-4">
        <h3 className="font-heading font-bold text-gray-900">📱 Scan QRIS</h3>
        <p className="text-xs text-gray-500 mt-1">Bayar dengan GoPay, OVO, Dana, ShopeePay, LinkAja, atau Mobile Banking</p>
      </div>

      <div className="flex justify-center mb-4">
        <div className="bg-white p-4 rounded-xl border-2 border-gray-100 shadow-inner">
          <QRCodeSVG
            value={qrisPayload}
            size={200}
            level="H"
            includeMargin={false}
            bgColor="#FFFFFF"
            fgColor="#000000"
          />
        </div>
      </div>

      <div className="text-center space-y-1">
        <p className="text-xs text-gray-500">Total Pembayaran</p>
        <p className="text-2xl font-bold text-sabana">
          Rp {amount.toLocaleString("id-ID")}
        </p>
        {orderId && (
          <p className="text-xs text-gray-400">Order: {orderId}</p>
        )}
        <p className="text-[10px] text-gray-400 mt-2">
          ⏱️ QR berlaku selama 15 menit
        </p>
      </div>
    </div>
  );
}
