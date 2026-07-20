import { WeComBin } from "./base";
import { WeComExternalContact } from "./externalcontact";

/**
 * Singleton initializer. Returns null when env CORPID is missing, in which case
 * callers should fall back to the mock data generator.
 */
const bin = process.env.CORPID
    ? new WeComBin({
          corpId: process.env.CORPID!,
          agentId: process.env.AGENTID || "",
          secret: process.env.WX_SECRET || "",
          baseUrl: process.env.WX_BASE_URL || "https://qyapi.weixin.qq.com/cgi-bin",
      })
    : null;

export function getWxBin(): WeComBin | null {
    return bin;
}

export function getExternalContact(): WeComExternalContact | null {
    return bin ? new WeComExternalContact(bin) : null;
}

export function isWxConfigured(): boolean {
    return bin !== null;
}

export { WeComBin, WeComExternalContact };
