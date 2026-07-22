/**
 * 标准订单插件（客户端）入口：组装 manifest + 详情区块 + 卡片角标。
 */
import { standardManifest } from "../../../../../shared/modules/order/plugins/standard.manifest";
import type { ClientOrderPlugin } from "../../plugin-registry";
import { StandardDetailSection, StandardCardBadge } from "./DetailSection";

export const standardClientPlugin: ClientOrderPlugin = {
    manifest: standardManifest,
    DetailSection: StandardDetailSection,
    CardBadge: StandardCardBadge,
};
