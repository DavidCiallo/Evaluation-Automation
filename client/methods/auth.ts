export enum AuthStatus {
    AUTH,
    NO_AUTH,
}

export function getAuthStatus(): AuthStatus {
    const token = localStorage.getItem("access_token");
    return token ? AuthStatus.AUTH : AuthStatus.NO_AUTH;
}

export function getAuth(): string {
    return localStorage.getItem("access_token") || "";
}

export function setAuth(token: string): void {
    localStorage.setItem("access_token", token);
}

export function clearAuth(): void {
    localStorage.removeItem("access_token");
}
