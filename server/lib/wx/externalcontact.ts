import { WeComBin } from "./base";

/** External contact (客户/外部联系人) endpoints used for resolving customer profile. */
export class WeComExternalContact {
    constructor(private bin: WeComBin) {}

    async getExternalContact(externalUserId: string): Promise<{
        errcode: number;
        errmsg: string;
        external_contact?: {
            external_userid: string;
            name: string;
            avatar: string;
            corp_name: string;
            gender: number;
        };
    }> {
        const res = await this.bin.get("/externalcontact/get", { external_userid: externalUserId });
        return res.data;
    }

    async getGroupchatList(ownerFilter: string[], cursor?: string): Promise<any> {
        const body: any = { owner_filter: { userid_list: ownerFilter }, limit: 100 };
        if (cursor) body.cursor = cursor;
        const res = await this.bin.post("/externalcontact/groupchat/list", body);
        return res.data;
    }

    async getGroupchatDetail(chatId: string): Promise<any> {
        const res = await this.bin.post("/externalcontact/groupchat/get", { chat_id: chatId, need_name: 1 });
        return res.data;
    }
}
