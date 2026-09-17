/**
 * Thermal Bluetooth Printer Integration
 * Uses Web Bluetooth API to connect to ESC/POS compatible thermal printers (58mm/80mm)
 * Compatible with Chinese thermal printers (Xprinter, etc.)
 */

// ESC/POS Command Constants
const ESC = 0x1b;
const GS = 0x1d;

const COMMANDS = {
  INIT: [ESC, 0x40],
  CUT: [GS, 0x56, 0x00],
  FEED_LINES: (n: number) => [ESC, 0x64, n],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  DOUBLE_HEIGHT_ON: [ESC, 0x21, 0x10],
  DOUBLE_HEIGHT_OFF: [ESC, 0x21, 0x00],
  DOUBLE_WIDTH_ON: [ESC, 0x21, 0x20],
  DOUBLE_WIDTH_OFF: [ESC, 0x21, 0x00],
  UNDERLINE_ON: [ESC, 0x2d, 0x01],
  UNDERLINE_OFF: [ESC, 0x2d, 0x00],
};

class ThermalPrinter {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private isConnected = false;

  async connect(): Promise<boolean> {
    try {
      if (!navigator.bluetooth) {
        throw new Error("Web Bluetooth tidak didukung di browser ini. Gunakan Chrome/Edge.");
      }
      
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          "000018f0-0000-1000-8000-00805f9b34fb",
          "0000ffe0-0000-1000-8000-00805f9b34fb",
          "0000fee7-0000-1000-8000-00805f9b34fb",
          "00001101-0000-1000-8000-00805f9b34fb",
          "00001800-0000-1000-8000-00805f9b34fb",
          "00001801-0000-1000-8000-00805f9b34fb",
        ],
      });

      if (!this.device?.gatt) return false;

      this.server = await this.device.gatt.connect();
      const services = await this.server.getPrimaryServices();
      
      for (const service of services) {
        try {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              this.isConnected = true;
              console.log(`[Printer] Connected: ${this.device.name || "Unknown"}`);
              return true;
            }
          }
        } catch (e) { /* skip */ }
      }

      // Fallback services
      for (const uuid of ["000018f0-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb"]) {
        try {
          const service = await this.server.getPrimaryService(uuid);
          const chars = await service.getCharacteristics();
          this.characteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse) || chars[0];
          this.isConnected = true;
          return true;
        } catch (e) { /* skip */ }
      }

      return false;
    } catch (err) {
      console.error("Bluetooth error:", err);
      return false;
    }
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.isConnected = false;
    this.characteristic = null;
    this.server = null;
    this.device = null;
  }

  private async send(data: number[]): Promise<void> {
    if (!this.characteristic) throw new Error("Printer not connected");
    const buffer = new Uint8Array(data);
    // Larger chunks for better throughput (BLE MTU is usually 244 on modern devices)
    const CHUNK_SIZE = 128;
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      const chunk = buffer.slice(i, i + CHUNK_SIZE);
      try {
        await this.characteristic.writeValueWithoutResponse(chunk);
      } catch {
        await this.characteristic.writeValueWithResponse(chunk);
      }
      // Small delay between chunks to prevent buffer overflow
      await new Promise(r => setTimeout(r, 10));
    }
  }

  private async sendText(
    text: string,
    options: { bold?: boolean; center?: boolean; right?: boolean; doubleHeight?: boolean; underline?: boolean } = {}
  ): Promise<void> {
    const commands: number[] = [];

    if (options.center) commands.push(...COMMANDS.ALIGN_CENTER);
    else if (options.right) commands.push(...COMMANDS.ALIGN_RIGHT);
    else commands.push(...COMMANDS.ALIGN_LEFT);

    if (options.bold) commands.push(...COMMANDS.BOLD_ON);
    if (options.doubleHeight) commands.push(...COMMANDS.DOUBLE_HEIGHT_ON);
    if (options.underline) commands.push(...COMMANDS.UNDERLINE_ON);

    const encoder = new TextEncoder();
    const textBytes = Array.from(encoder.encode(text));
    commands.push(...textBytes);

    if (options.bold) commands.push(...COMMANDS.BOLD_OFF);
    if (options.doubleHeight) commands.push(...COMMANDS.DOUBLE_HEIGHT_OFF);
    if (options.underline) commands.push(...COMMANDS.UNDERLINE_OFF);
    commands.push(...COMMANDS.ALIGN_LEFT);

    await this.send(commands);
  }

  // Print a line with left/right alignment on same line
  private async printLine(left: string, right: string, maxWidth = 32): Promise<void> {
    // Truncate left if too long
    const maxLeft = maxWidth - right.length - 1;
    const truncatedLeft = left.length > maxLeft ? left.slice(0, maxLeft - 1) + "…" : left;
    const padding = maxWidth - truncatedLeft.length - right.length;
    const spaces = " ".repeat(Math.max(1, padding));
    await this.sendText(`${truncatedLeft}${spaces}${right}\n`);
  }

  // Print separator line using ASCII-safe characters
  private async printSeparator(char = "-", maxWidth = 32): Promise<void> {
    await this.sendText(char.repeat(maxWidth) + "\n");
  }

  // Truncate text to fit within maxWidth
  private truncate(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) return text;
    return text.slice(0, maxWidth - 1) + "\u2026"; // ellipsis
  }

  async printReceipt(data: {
    items: { name: string; qty: number; price: number }[];
    subtotal: number;
    discount?: number;
    total: number;
    amountPaid: number;
    change: number;
    paymentMethod: string;
    cashierName: string;
    serviceMode: string;
    orderNumber: string;
    date: string;
    outletName?: string;
    outletAddress?: string;
    outletPhone?: string;
  }): Promise<boolean> {
    if (!this.isConnected) {
      const connected = await this.connect();
      if (!connected) return false;
    }

    try {
      // Initialize
      await this.send(COMMANDS.INIT);
      await new Promise(r => setTimeout(r, 200));

      const W = 32; // 58mm = 32 chars, 80mm = 48 chars

      // === HEADER ===
      const name = this.truncate(data.outletName || "SABANA FRIED CHICKEN", W);
      await this.sendText(name, { center: true, bold: true, doubleHeight: true });
      await new Promise(r => setTimeout(r, 50));
      
      if (data.outletAddress) {
        await this.sendText(this.truncate(data.outletAddress, W), { center: true });
      }
      if (data.outletPhone) {
        await this.sendText(this.truncate(data.outletPhone, W), { center: true });
      }
      
      await this.printSeparator("=", W);

      // === ORDER INFO ===
      await this.sendText(`  ${this.truncate(data.date, W - 2)}`);
      await new Promise(r => setTimeout(r, 20));
      await this.sendText(`  ${this.truncate(data.orderNumber, W - 2)}`);
      await this.sendText(`  Kasir: ${this.truncate(data.cashierName, W - 8)}`);
      await this.sendText(`  ${this.truncate(data.serviceMode, W - 2)}`);
      
      await this.printSeparator("-", W);

      // === ITEMS ===
      for (const item of data.items) {
        const itemTotal = (item.price * item.qty).toLocaleString("id-ID");
        const left = `${item.qty}x ${item.name}`;
        await this.printLine(left, `Rp ${itemTotal}`, W);
        await new Promise(r => setTimeout(r, 10));
      }

      await this.printSeparator("-", W);

      // === TOTALS ===
      await this.printLine("Subtotal:", `Rp ${data.subtotal.toLocaleString("id-ID")}`, W);
      
      if (data.discount && data.discount > 0) {
        await this.printLine("Diskon:", `-Rp ${data.discount.toLocaleString("id-ID")}`, W);
      }
      
      await this.printLine("TOTAL:", `Rp ${data.total.toLocaleString("id-ID")}`, W);
      await new Promise(r => setTimeout(r, 50));
      
      await this.sendText("", { bold: false });
      await this.printLine("BAYAR:", `Rp ${data.amountPaid.toLocaleString("id-ID")}`, W);
      await this.printLine("KEMBALIAN:", `Rp ${data.change.toLocaleString("id-ID")}`, W);
      
      await this.printSeparator("-", W);

      const method = data.paymentMethod.toUpperCase();
      await this.sendText(`  Metode: ${method}`);
      
      await this.printSeparator("=", W);

      // === FOOTER ===
      await this.sendText("Terima kasih!", { center: true });
      await this.sendText("Sampai jumpa!", { center: true });
      await new Promise(r => setTimeout(r, 50));
      await this.sendText("Sabana Fried Chicken", { center: true, bold: true });

      // Feed paper and cut
      await this.send([...COMMANDS.FEED_LINES(3)]);
      await new Promise(r => setTimeout(r, 200));
      await this.send([...COMMANDS.CUT]);

      return true;
    } catch (err) {
      console.error("Print error:", err);
      return false;
    }
  }
}

let printerInstance: ThermalPrinter | null = null;

export function getPrinter(): ThermalPrinter {
  if (!printerInstance) {
    printerInstance = new ThermalPrinter();
  }
  return printerInstance;
}

export function isBluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}
