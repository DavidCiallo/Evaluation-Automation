import { AccountEntity } from "../account/account.entity";


export class LoginBody {
    public email: string;
    public password: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Pick<AccountEntity, "email" | "password">) {
        if (!origin.email || !origin.password) {
            throw new Error("Email and password are required");
        }
        this.email = origin.email;
        this.password = origin.password;
    }

    static self(unsafe: LoginBody) {
        return new LoginBody(unsafe);
    }
}


export class LoginRequest {
    public auth?: string;
    public identify: LoginBody;

    constructor(origin: Partial<LoginRequest>) {
        if (!origin.identify) throw new Error("Login data is required");
        origin.auth && (this.auth = origin.auth);
        this.identify = LoginBody.self(origin.identify);
    }

    static self(unsafe: LoginRequest) {
        return new LoginRequest(unsafe);
    }
}

export class LoginResponse {
    public success: boolean;
    public message: string;
    public data: {
        token: string;
    };

    constructor(origin: LoginResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AliveRequest {
    public auth?: string;

    constructor(origin: Partial<AliveRequest>) {
        this.auth = origin.auth;
    }

    static self(unsafe: AliveRequest) {
        return new AliveRequest(unsafe);
    }
}

export class AliveResponse {
    public success: boolean;
    public message: string;

    constructor(origin: AliveResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}
