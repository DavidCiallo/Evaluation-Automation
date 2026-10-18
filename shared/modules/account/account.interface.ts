import { AccountEntity, AccountFile } from "./account.entity";


export class AccountDTO {
    public id: string;
    public name: string;
    public email: string;
    public wechat_id: string;
    public role: string;
    public files: AccountFile[];

    private isTypeSafe: symbol = Symbol();

    constructor(origin: AccountEntity) {
        this.id = origin.id;
        this.name = origin.name;
        this.email = origin.email;
        this.wechat_id = origin.wechat_id || "";
        this.role = origin.role || "";
        this.files = (origin.files || []).map((f) => ({ ...f }));
    }
}



export class AccountQueryBody {
    public id?: string;
    public name?: string;
    public email?: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<AccountEntity>) {
        if (false) throw new Error("Unexpected error");
        origin.id && (this.id = origin.id);
        origin.name && (this.name = origin.name);
        origin.email && (this.email = origin.email);
    }

    static self(unsafe: AccountQueryBody) {
        return new AccountQueryBody(unsafe);
    }
}

export class AccountCreateBody {
    public name: string;
    public email: string;
    public password: string;
    public wechat_id: string;
    public role: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<Pick<AccountEntity, "name" | "email" | "password" | "wechat_id">> & { role?: string }) {
        if (!origin.name) {
            throw new Error("Name is required");
        }
        if (!origin.email && !origin.wechat_id) {
            throw new Error("Email or wechat_id is required");
        }
        this.name = origin.name;
        this.email = origin.email || "";
        this.password = origin.password || "";
        this.wechat_id = origin.wechat_id || "";
        this.role = origin.role || "";
    }

    static self(unsafe: AccountCreateBody) {
        return new AccountCreateBody(unsafe);
    }
}

export class AccountUpdateBody {
    public name: string;
    public email: string;
    public password: string;
    public files?: AccountFile[];

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<AccountEntity> = {}) {
        if (!origin.name && !origin.email && !origin.password && origin.files === undefined) {
            throw new Error("Least one field not null");
        }
        this.name = origin.name || "";
        this.email = origin.email || "";
        this.password = origin.password || "";
        if (origin.files !== undefined) this.files = origin.files;
    }

    static self(unsafe: AccountUpdateBody) {
        return new AccountUpdateBody(unsafe);
    }
}





export class AccountListRequest {
    public auth?: string;
    public page: number;
    public filter?: AccountQueryBody;

    constructor(origin: Partial<AccountListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.filter && (this.filter = AccountQueryBody.self(origin.filter));
        this.page = Number(origin.page || 1);
    }
    static self(unsafe: AccountListRequest) {
        return new AccountListRequest(unsafe);
    }
}

export class AccountListResponse {
    public success: boolean;
    public message: string;
    public data: {
        list: AccountDTO[],
        total: number
    };

    constructor(origin: AccountListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountDetailRequest {
    public auth?: string;
    public id: string;

    constructor(origin: AccountDetailRequest) {
        if (!origin.id) {
            throw new Error("Id is required");
        }
        this.id = origin.id;
    }
    static self(unsafe: AccountDetailRequest) {
        return new AccountDetailRequest(unsafe);
    }
}

export class AccountDetailResponse {
    public success: boolean;
    public message: string;
    public data: {
        account: AccountDTO | null
    };

    constructor(origin: AccountDetailResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountCreateRequest {
    public auth?: string;
    public account: AccountCreateBody;

    constructor(origin: Partial<AccountCreateRequest>) {
        if (!origin.account) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.account = AccountCreateBody.self(origin.account);
    }
    static self(unsafe: AccountCreateRequest) {
        return new AccountCreateRequest(unsafe);
    }
}

export class AccountCreateResponse {
    public success: boolean;
    public message: string;
    public data: {
        account: AccountDTO | null
    };

    constructor(origin: AccountCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountUpdateRequest {
    public auth?: string;
    public id: string;
    public account: AccountUpdateBody;

    constructor(origin: Partial<AccountUpdateRequest>) {
        if (!origin.id || !origin.account) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.account = AccountUpdateBody.self(origin.account);
    }
    static self(unsafe: AccountUpdateRequest) {
        return new AccountUpdateRequest(unsafe);
    }
}

export class AccountUpdateResponse {
    public success: boolean;
    public message: string;
    public data: {
        account: AccountDTO | null
    };

    constructor(origin: AccountUpdateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountDeleteRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<AccountDeleteRequest>) {
        if (!origin.id) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
    }
    static self(unsafe: AccountDeleteRequest) {
        return new AccountDeleteRequest(unsafe);
    }
}

export class AccountDeleteResponse {
    public success: boolean;
    public message: string;

    constructor(origin: AccountDeleteResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}
