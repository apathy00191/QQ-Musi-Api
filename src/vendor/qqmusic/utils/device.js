/**
 * 设备信息生成与持久化管理.
 * 使用 JSON 文件持久化, 启动时若不存在则生成默认设备.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { randomHex } from "./common.js";

/** 随机生成满足 Luhn 校验的 IMEI */
export function randomImei() {
  const digits = [];
  for (let i = 0; i < 14; i++) digits.push(Math.floor(Math.random() * 10));
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let v = digits[i];
    if (i % 2 === 1) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
  }
  const ctrl = (10 - (sum % 10)) % 10;
  digits.push(ctrl);
  return digits.join("");
}

/** 生成默认 Android 设备指纹 */
export function makeDefaultDevice() {
  const rand = (n) => Math.floor(Math.random() * n).toString();
  return {
    display: `QMAPI.${rand(999999 - 100000) + 100000}.001`,
    product: "iarim",
    device: "sagit",
    board: "eomam",
    model: "MI 6",
    fingerprint: `xiaomi/iarim/sagit:10/eomam.200122.001/${rand(9999999 - 1000000) + 1000000}:user/release-keys`,
    bootId: randomUUID(),
    procVersion: `Linux 5.4.0-54-generic-${randomHex(4)} (android-build@google.com)`,
    imei: randomImei(),
    brand: "Xiaomi",
    bootloader: "U-boot",
    baseBand: "",
    version: {
      incremental: "5891938",
      release: "10",
      codename: "REL",
      sdk: 29,
    },
    simInfo: "T-Mobile",
    osType: "android",
    macAddress: "00:50:56:C0:00:08",
    ipAddress: [10, 0, 1, 3],
    wifiBssid: "00:50:56:C0:00:08",
    wifiSsid: "<unknown ssid>",
    imsiMd5: Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)),
    androidId: randomHex(8),
    apn: "wifi",
    vendorName: "MIUI",
    vendorOsName: "qmapi",
    openUdid: randomUUID().replace(/-/g, ""),
  };
}

/** 设备管理器 */
export class DeviceManager {
  constructor(devicePath) {
    this._path = devicePath ? (isAbsolute(devicePath) ? devicePath : resolve(devicePath)) : undefined;
    this._device = null;
  }

  async getDevice() {
    if (this._device) return this._device;
    if (!this._path) {
      this._device = makeDefaultDevice();
      return this._device;
    }
    try {
      if (existsSync(this._path)) {
        const raw = JSON.parse(readFileSync(this._path, "utf-8"));
        this._device = raw;
      } else {
        this._device = makeDefaultDevice();
        this.save();
      }
    } catch {
      this._device = makeDefaultDevice();
    }
    return this._device;
  }

  async save() {
    if (!this._device || !this._path) return;
    const dir = dirname(this._path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this._path, JSON.stringify(this._device, null, 2), "utf-8");
  }

  async applyQimei(q16, q36) {
    const device = await this.getDevice();
    device.qimei = q16;
    device.qimei36 = q36;
    device.qimeiSaveTime = Math.floor(Date.now() / 1000);
    await this.save();
  }
}
