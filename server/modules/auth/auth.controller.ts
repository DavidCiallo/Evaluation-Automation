import { AliveRequest, LoginRequest } from "../../../shared/modules/auth/auth.interface";
import { authRoutes } from "../../../shared/modules/auth/auth.router";
import { getIdentifyByVerify, loginUser } from "./auth.service";

async function alive(request: AliveRequest) {
    request = AliveRequest.self(request);
    const { auth } = request;
    if (auth && getIdentifyByVerify(auth)) {
        return { success: true, message: "Authorized" };
    } else {
        return { success: false, message: "Unauthorized" };
    }
}

async function login(request: LoginRequest) {
    request = LoginRequest.self(request);
    const { identify } = request;
    if (!identify) {
        throw "Authorized failed";
    }
    const { email, password } = identify;
    const { token } = await loginUser(email, password);
    if (!token) {
        throw "账号或密码错误";
    }
    return { token };
}

export const authMount = {
    routes: authRoutes,
    handlers: { alive, login },
};
