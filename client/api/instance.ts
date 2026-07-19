import { createClient } from "../lib/create-client";
import { authRoutes } from "../../shared/modules/auth/auth.router";
import { accountRoutes } from "../../shared/modules/account/account.router";
import { demoRoutes } from "../../shared/modules/demo/demo.router";
import { blogRoutes } from "../../shared/modules/blog/blog.router";

export const authApi = createClient(authRoutes);
export const accountApi = createClient(accountRoutes);
export const demoApi = createClient(demoRoutes);
export const blogApi = createClient(blogRoutes);
