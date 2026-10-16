import {
    FileListResponse,
    FileDetailResponse,
    FileUploadResponse,
    FileRemoveResponse,
} from "./file.interface";

export const fileRoutes = {
    base: "/api",
    prefix: "/file",
    list: {
        path: "/list",
        request: {} as { keyword?: string; page?: number; auth?: string },
        response: {} as FileListResponse,
    },
    detail: {
        path: "/detail",
        request: {} as { id: string; auth?: string },
        response: {} as FileDetailResponse,
    },
    upload: {
        path: "/upload",
        request: {} as { file: File; uploaded_by?: string; auth?: string },
        response: {} as FileUploadResponse,
    },
    remove: {
        path: "/remove",
        request: {} as { id: string; auth?: string },
        response: {} as FileRemoveResponse,
    },
} as const;