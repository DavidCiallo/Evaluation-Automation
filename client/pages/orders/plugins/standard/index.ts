import { standardManifest } from "../../../../../shared/modules/order/plugins/standard.manifest";
import type { ClientOrderPlugin } from "../../plugin-registry";
import { StandardDetailSection, StandardCardBadge } from "./DetailSection";

export const standardClientPlugin: ClientOrderPlugin = {
    manifest: standardManifest,
    DetailSection: StandardDetailSection,
    CardBadge: StandardCardBadge,
};
