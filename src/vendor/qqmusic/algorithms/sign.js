/**
 * ZZC 签名算法.
 */

import { createHash } from "node:crypto";

const PART_1_INDEXES = [23, 14, 6, 36, 16, 7, 19];
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const SCRAMBLE_VALUES = [
  89, 39, 179, 150, 218, 82, 58, 252, 177, 52,
  186, 123, 120, 64, 242, 133, 143, 161, 121, 179,
];

/**
 * 计算 QQ 音乐 zzc 签名.
 * @param {string|Buffer|Uint8Array} payload 明文(字符串或 Buffer)
 * @returns {string} 形如 "zzc<part1><b64part><part2>" 的小写签名字符串
 */
export function zzcSign(payload) {
  const bytes =
    typeof payload === "string"
      ? Buffer.from(payload, "utf-8")
      : Buffer.from(payload);
  const hashHex = createHash("sha1").update(bytes).digest("hex").toUpperCase();

  const part1 = PART_1_INDEXES.map((i) => hashHex[i]).join("");
  const part2 = PART_2_INDEXES.map((i) => hashHex[i]).join("");

  const part3 = new Array(20);
  for (let i = 0; i < 20; i++) {
    const pair = parseInt(hashHex.substring(i * 2, i * 2 + 2), 16);
    part3[i] = SCRAMBLE_VALUES[i] ^ pair;
  }

  const b64 = Buffer.from(part3)
    .toString("base64")
    .replace(/[\\/+=]/g, "");

  return `zzc${part1}${b64}${part2}`.toLowerCase();
}
