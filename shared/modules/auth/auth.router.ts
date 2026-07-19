import { LoginResponse, AliveResponse } from "./auth.interface";

export const authRoutes = {
    base: "/api",
    prefix: "/auth",
    login: {
        path: "/login",
        request: {} as { identify: { email: string; password: string }; auth?: string },
        response: {} as LoginResponse,
    },
    alive: {
        path: "/alive",
        request: {} as { auth?: string },
        response: {} as AliveResponse,
    },
} as const;
