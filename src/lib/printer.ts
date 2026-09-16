/**
 * Thermal Bluetooth Printer Integration
 * Uses Web Bluetooth API to connect to ESC/POS compatible thermal printers (58mm/80mm)
 * Compatible with Chinese thermal printers (Xprinter, etc.)
 */

// ESC/POS Command Constants
const ESC = 0x1b;
const GS = 0x1d;

const COMMANDS = {
  // Initialize printer
  INIT: [ESC, 0x40],
  // Cut paper (partial cut)
  CUT: [GS, 0x56, 0x00],
  // Feed paper
  FEED_LINES: (n: number) => [ESC, 0x64, n],
  // Bold on/off
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  // Center alignment
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  // Left alignment
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  // Right alignment
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  // Double height
  DOUBLE_HEIGHT_ON: [ESC, 0x21, 0x10],
  DOUBLE_HEIGHT_OFF: [ESC, 0x21, 0x00],
  // Underline
  UNDERLINE_ON: [ESC, 0x2d, 0x01],
  UNDERLINE_OFF: [ESC, 0x2d, 0x00],
};

class ThermalPrinter {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private isConnected = false;

  // Connect to thermal printer via Web Bluetooth
  async connect(): Promise<boolean> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [] },  // Accept all BLE devices
          { namePrefix: "XP" },  // Xprinter
          { namePrefix: "XT" },  // Xprinter
          { namePrefix: "TM" },  // Epson
          { namePrefix: "BP" },  // Bixolon
        ],
        optionalServices: [
          "000018f0-0000-1000-8000-00805f9b34fb",  // Common thermal printer service
          "0000ffe0-0000-1000-8000-00805f9b34fb",  // Another common service
          "0000fee7-0000-1000-8000-00805f9b34fb",  // Chinese printers
        ],
      });

      if (!this.device?.gatt) return false;

      this.server = await this.device.gatt.connect();
      
      // Try to find the write characteristic
      const services = await this.server.getPrimaryServices();
      
      for (const service of services) {
        try {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              this.isConnected = true;
              console.log(`Connected to printer: ${this.device.name || "Unknown"}`);
              return true;
            }
          }
        } catch {}
      }

      // Fallback: try common service UUIDs
      try {
        const service = await this.server.getPrimaryService("000018f0-0000-1000-8000-00805f9b34fb");
        const chars = await service.getCharacteristics();
        this.characteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse) || chars[0];
        this.isConnected = true;
        return true;
      } catch {}

      return false;
    } catch (err) {
      console.error("Bluetooth connection error:", err);
      return false;
    }
  }

  // Disconnect
  disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.isConnected = false;
    this.characteristic = null;
    this.server = null;
    this.device = null;
  }

  // Send raw bytes to printer
  private async send(data: number[]): Promise<void> {
    if (!this.characteristic) throw new Error("Printer not connected");
    
    const buffer = new Uint8Array(data);
    
    // Send in chunks (BLE has MTU limit ~20 bytes)
    const CHUNK_SIZE = 20;
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      const chunk = buffer.slice(i, i + CHUNK_SIZE);
      try {
        await this.characteristic.writeValueWithoutResponse(chunk);
      } catch {
        await this.characteristic.writeValueWithResponse(chunk);
      }
    }
  }

  // Send text with optional formatting
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

    // Convert text to bytes (UTF-8)
    const encoder = new TextEncoder();
    const textBytes = Array.from(encoder.encode(text));
    commands.push(...textBytes);

    if (options.bold) commands.push(...COMMANDS.BOLD_OFF);
    if (options.doubleHeight) commands.push(...COMMANDS.DOUBLE_HEIGHT_OFF);
    if (options.underline) commands.push(...COMMANDS.UNDERLINE_OFF);
    commands.push(...COMMANDS.ALIGN_LEFT);

    await this.send(commands);
  }

  // Print a line with left/right alignment
  private async printLine(left: string, right: string, maxWidth = 32): Promise<void> {
    const padding = maxWidth - left.length - right.length;
    const spaces = " ".repeat(Math.max(0, padding));
    await this.sendText(`${left}${spaces}${right}\n`);
  }

  // Print horizontal line
  private async printLine2(char = "─", maxWidth = 32): Promise<void> {
    await this.sendText(char.repeat(maxWidth) + "\n");
  }

  // Main print receipt function
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
      await new Promise(r => setTimeout(r, 100));

      const W = 32; // Width for 58mm printer (32 chars) or 80mm (48 chars)

      // Header
      await this.sendText(data.outletName || "SABANA FRIED CHICKEN", { center: true, bold: true, doubleHeight: true });
      if (data.outletAddress) await this.sendText(data.outletAddress, { center: true });
      if (data.outletPhone) await this.sendText(data.outletPhone, { center: true });
      await this.printLine2("═", W);

      // Order info
      await this.sendText(`${data.date}`, { center: false });
      await this.sendText(`${data.orderNumber}`, { center: false });
      await this.sendText(`Kasir: ${data.cashierName}`);
      await this.sendText(`${data.serviceMode}`);
      await this.printLine2("─", W);

      // Items
      for (const item of data.items) {
        const left = `${item.qty}x ${item.name}`;
        const right = `Rp ${(item.price * item.qty).toLocaleString("id-ID")}`;
        await this.printLine(left, right, W);
      }

      await this.printLine2("─", W);

      // Totals
      await this.printLine("Subtotal:", `Rp ${data.subtotal.toLocaleString("id-ID")}`, W);
      if (data.discount && data.discount > 0) {
        await this.printLine("Diskon:", `-Rp ${data.discount.toLocaleString("id-ID")}`, W);
      }
      await this.printLine("TOTAL:", `Rp ${data.total.toLocaleString("id-ID")}`, W);
      await this.printLine("BAYAR:", `Rp ${data.amountPaid.toLocaleString("id-ID")}`, W);
      await this.printLine("KEMBALIAN:", `Rp ${data.change.toLocaleString("id-ID")}`, W);
      await this.sendText(`Metode: ${data.paymentMethod.toUpperCase()}`);
      
      await this.printLine2("═", W);

      // Footer
      await this.sendText("Terima kasih!", { center: true });
      await this.sendText("Sampai jumpa!", { center: true });
      await this.sendText("Sabana Fried Chicken", { center: true, bold: true });

      // Feed and cut
      await this.send([...COMMANDS.FEED_LINES(3)]);
      await this.send([...COMMANDS.CUT]);

      return true;
    } catch (err) {
      console.error("Print error:", err);
      return false;
    }
  }
}

// Singleton instance
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
