import { aesDecrypt } from "../methods/crypto";

export function verifyToken(token: string | null | undefined): string | null {
    if (!token) return null;
    const dt = aesDecrypt(String(token));
    if (!dt) return null;
    const [identity, expried] = dt.split("|-|");
    if (!identity || Date.now() > Number(expried)) return null;
    return identity;
}
