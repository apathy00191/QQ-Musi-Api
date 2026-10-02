/**
 * QRC 解密算法.
 *
 * 输入是**hex 字符串**编码的 QRC 加密数据(QQ 歌词接口直接返回).
 * 输出是解密后经 zlib 解压还原的 QRC XML/LRC 文本.
 *
 * 注意: 该实现使用项目自带的自定义 TripleDES(algorithms/tripledes.js),
 * 1:1 移植自 C# 原始实现.
 * 标准 Node.js crypto 的 des-ede3-ecb **不能**解出正确结果.
 */

import { inflateSync } from "node:zlib";
import { tripledesCrypt, tripledesKeySetup, DECRYPT } from "./tripledes.js";

const QRC_3DES_KEY = Buffer.from("!@#)(*$%123ZXC!@!@#)(NHL", "utf-8");

/**
 * 解密 QRC 歌词数据.
 * @param {string} encryptedQrc 加密的 QRC 数据(hex 字符串, QQ API 原样返回)
 * @returns {string} 解密后的 QRC 文本
 */
export function qrcDecrypt(encryptedQrc) {
  if (!encryptedQrc) return "";

  // 1) hex 解码 -> 原始密文
  let bytes;
  try {
    bytes = Buffer.from(encryptedQrc, "hex");
  } catch (e) {
    throw new Error(`QRC hex 解码失败: ${e.message}`);
  }
  if (bytes.length === 0) return "";

  // 2) 自定义 TripleDES ECB 解密(8 字节块)
  let decrypted;
  try {
    const schedule = tripledesKeySetup(QRC_3DES_KEY, DECRYPT);
    decrypted = Buffer.alloc(bytes.length);
    for (let i = 0; i + 8 <= bytes.length; i += 8) {
      const block = bytes.subarray(i, i + 8);
      const dec = tripledesCrypt(block, schedule);
      decrypted.set(dec, i);
    }
  } catch (e) {
    throw new Error(`QRC 3DES 解密失败: ${e.message}`);
  }

  // 3) zlib 解压 (解密后是 zlib 格式, 头为 78 9C, 不是 gzip 的 1F 8B)
  try {
    const inflated = inflateSync(decrypted);
    return inflated.toString("utf-8");
  } catch (e) {
    throw new Error(`QRC zlib 解压失败: ${e.message} (decrypted first 16 bytes: ${decrypted.subarray(0, 16).toString("hex")})`);
  }
}
