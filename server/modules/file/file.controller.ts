import { fileRoutes } from "../../../shared/modules/file/file.router";
import {
    FileListRequest,
    FileDetailRequest,
    FileRemoveRequest,
} from "../../../shared/modules/file/file.interface";
import * as svc from "./file.service";

async function list(request: FileListRequest) {
    const req = FileListRequest.self(request);
    const { list, total } = await svc.list(req.keyword, req.page);
    return { list, total };
}

async function detail(request: FileDetailRequest) {
    const req = FileDetailRequest.self(request);
    const file = await svc.findOne(req.id);
    if (!file) throw "file not found";
    return { file: svc.toDTO(file) };
}

async function remove(request: FileRemoveRequest) {
    const req = FileRemoveRequest.self(request);
    await svc.remove(req.id);
    return { ok: true };
}

export const fileMount = {
    routes: fileRoutes,
    handlers: { list, detail, remove },
    /**
     * 上传：multipart/form-data（field: file, uploaded_by）。
     * 直接返回 Response（multipart 请求体在 mounthttp 之前被 app 层拦截调用本方法）。
     */
    uploadMultipart: async (req: Request): Promise<Response> => {
        const wrapOk = (data: any) => new Response(JSON.stringify({ success: true, data }), {
            headers: { "Content-Type": "application/json" },
        });
        const wrapErr = (msg: string) => new Response(JSON.stringify({ success: false, message: msg, data: null }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
        try {
            const formData = await req.formData();
            const file = formData.get("file") as File | null;
            if (!file) return wrapErr("no file");
            const uploaded_by = (formData.get("uploaded_by") as string | null) || "";
            const buf = Buffer.from(await file.arrayBuffer());
            const { storage_name, content_type } = svc.saveToDisk(buf, file.name);
            const dto = await svc.createFile({
                filename: file.name,
                storage_name,
                content_type,
                size: buf.byteLength,
                uploaded_by,
            });
            return wrapOk({ file: dto });
        } catch (e: any) {
            return wrapErr(typeof e === "string" ? e : (e?.message || "upload failed"));
        }
    },
};