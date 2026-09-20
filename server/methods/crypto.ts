import crypto from "crypto";

/**
 * 会话密钥必须显式配置 SECRET（至少 16 字符），缺失时启动即失败。
 * 历史上未配置时退化为 Date.now().toString(36)：既是可预测的弱密钥，
 * 又导致每次进程重启后全部在线 token 失效。
 */
const secret = process.env.SECRET;
if (!secret || secret.length < 16) {
    throw new Error("SECRET 环境变量必须设置且长度不小于 16（用于会话 token 加密），请在 .env 中配置");
}

const noncelen = Number(process.env.NONCE_LENGTH) || 4;

if (noncelen < 6) {
    console.warn("NONCE_LENGTH 过小（建议 >= 6）");
}

const secretKey = crypto.createHash("sha256").update(secret).digest();
/** AES 块 16 字节 = 32 个十六进制字符；每次加密生成全新随机 IV 并前置到密文。 */
const IV_HEX_LEN = 32;

/**
 * Token 加密：每次调用生成新的随机 IV，格式为 iv(hex) + 密文(hex)。
 * 修复旧的模块级固定 IV —— CBC 模式下同一 IV 会使相同前缀的明文产生相同密文。
 * 载荷为明文 `identity|expried`（旧的字符反转混淆一并移除）。
 * 注意：格式变更使升级前签发的 token 全部失效，用户需重新登录（预期行为）。
 */
export function aesEncrypt(originalData: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", secretKey, iv);
    let encryptedData = cipher.update(originalData, "utf8", "hex");
    encryptedData += cipher.final("hex");
    return iv.toString("hex") + encryptedData;
}

export function aesDecrypt(encryptedData: string): string | null {
    try {
        if (typeof encryptedData !== "string" || encryptedData.length <= IV_HEX_LEN) return null;
        const iv = Buffer.from(encryptedData.slice(0, IV_HEX_LEN), "hex");
        if (iv.length !== 16) return null;
        const decipher = crypto.createDecipheriv("aes-256-cbc", secretKey, iv);
        let decryptedData = decipher.update(encryptedData.slice(IV_HEX_LEN), "hex", "utf8");
        decryptedData += decipher.final("utf8");
        return decryptedData;
    } catch {
        return null;
    }
}

export function hashGenerate(originalData: string): string {
    return crypto.createHash("sha256").update(originalData).digest("hex");
}

export function codeGenerate(originalData: string): string {
    return String(1000 + (([...originalData].reduce((a, c) => a + c.charCodeAt(0), 1) * noncelen) % 9000));
}
