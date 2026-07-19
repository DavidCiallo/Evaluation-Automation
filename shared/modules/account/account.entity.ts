export interface AccountEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    name: string;
    email: string;
    password: string;
}
