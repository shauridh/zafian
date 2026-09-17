/**
 * Thermal Bluetooth Printer Integration
 * Uses Web Bluetooth API to connect to ESC/POS compatible thermal printers (58mm/80mm)
 * Compatible with Chinese thermal printers (Xprinter, etc.)
 *
 * Receipt CONTENT is built by lib/receipt.ts (single source of truth);
 * this file only handles BLE transport + ESC/POS styling commands.
 */
import { buildReceiptLines, RECEIPT_WIDTH_58, type ReceiptData } from "@/lib/receipt";

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

  // Print separator line using ASCII-safe characters
  private async printSeparator(char = "-", maxWidth = RECEIPT_WIDTH_58): Promise<void> {
    await this.sendText(char.repeat(maxWidth) + "\n");
  }

  async printReceipt(data: ReceiptData & { width?: number }): Promise<boolean> {
    if (!this.isConnected) {
      const connected = await this.connect();
      if (!connected) return false;
    }

    try {
      // Initialize
      await this.send(COMMANDS.INIT);
      await new Promise(r => setTimeout(r, 200));

      const W = data.width ?? RECEIPT_WIDTH_58; // 58mm = 32 chars, 80mm = 48 chars
      const lines = buildReceiptLines(data, W);

      // Header (first content line after top rule) — bold + double height.
      // sendText(center:true) re-centers on the printer, so strip the margin.
      const headerIdx = 1; // lines[0] is the top "=" rule
      const header = lines[headerIdx] ?? "";
      const body = lines.filter((_, idx) => idx !== 0 && idx !== headerIdx);

      await this.sendText(header.trim(), { center: true, bold: true, doubleHeight: true });
      await new Promise(r => setTimeout(r, 50));

      for (const line of body) {
        const isRule = /^[-=]+$/.test(line.trim());
        if (isRule) {
          await this.printSeparator(line.trim()[0] || "-", W);
        } else {
          // Lines come pre-padded to W by buildReceiptLines — print verbatim
          // so the ESC/POS output matches the on-screen preview exactly.
          await this.sendText(`${line}\n`);
        }
        await new Promise(r => setTimeout(r, 10));
      }

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
