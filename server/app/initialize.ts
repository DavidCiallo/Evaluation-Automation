import { registerUser } from "../modules/auth/auth.service";
import Repository from "../lib/repository";

export async function initialize() {
    if (process.env.ADMIN_NAME && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
        const accountRepo = Repository.instance<any>("Account");
        const existing = await accountRepo.findOne({ email: process.env.ADMIN_EMAIL });
        if (!existing) {
            await registerUser(
                process.env.ADMIN_NAME,
                process.env.ADMIN_EMAIL,
                process.env.ADMIN_PASSWORD
            );
        }
    }
}
