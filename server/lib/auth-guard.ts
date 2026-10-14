/**
 * 统一鉴权守卫（lib 层，供 mount.ts 在路由分发前调用）。
 *
 * 校验逻辑与 modules/auth/auth.service.ts 的 getIdentifyByVerify 完全一致
 * （解密 token → 解析 identity|expried → 校验过期），但放在 lib 层且只依赖
 * methods/crypto，避免 lib → modules 的反向依赖。
 *
 * 语义：返回非空字符串 = 已授权（返回 identity）；null = 未授权/token 无效。
 */
import { aesDecrypt } from "../methods/crypto";

export function verifyToken(token: string | null | undefined): string | null {
    if (!token) return null;
    const dt = aesDecrypt(String(token));
    if (!dt) return null;
    const [identity, expried] = dt.split("|-|");
    if (!identity || Date.now() > Number(expried)) return null;
    return identity;
}
