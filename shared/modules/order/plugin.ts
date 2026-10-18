
export type OrderFieldType = "text" | "number" | "money" | "date" | "select" | "textarea";

export interface OrderFieldDef {
    key: string;
    label: string;
    type: OrderFieldType;
    options?: string[];
    required?: boolean;
}

export interface OrderPluginManifest {
    id: string;
    name: string;
    version: string;
    fields: OrderFieldDef[];
    defaultEnabled: boolean;
}
