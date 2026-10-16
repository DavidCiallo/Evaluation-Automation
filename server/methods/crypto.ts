import crypto from "crypto";

const secret = process.env.SECRET;
if (!secret || secret.length < 16) {
    throw new Error("SECRET 环境变量必须设置且长度不小于 16（用于会话 token 加密），请在 .env 中配置");
}

const noncelen = Number(process.env.NONCE_LENGTH) || 4;

if (noncelen < 6) {
    console.warn("NONCE_LENGTH 过小（建议 >= 6）");
}

const secretKey = crypto.createHash("sha256").update(secret).digest();
const IV_HEX_LEN = 32;

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
