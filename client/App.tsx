import {
    BrowserRouter as Router,
    Routes,
    Route,
    Navigate,
    Outlet,
    useLocation,
} from "react-router-dom";
import { ThemeProvider } from "@/client/components/theme-provider";
import { Toaster } from "@/client/components/ui/sonner";
import { AdminLayout } from "@/client/components/admin/layout";
import { AuthPage } from "./pages/auth/AuthPage";
import { AccountPage } from "./pages/account/AccountPage";
import { DemoPage } from "./pages/demo/DemoPage";
import { BlogPage } from "./pages/blog/BlogPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { getAuth } from "./methods/auth";

function PrivateRoute() {
    const location = useLocation();
    if (!getAuth()) {
        return <Navigate to="/auth" replace state={{ from: location }} />;
    }
    return <Outlet />;
}

export default function App() {
    return (
        <ThemeProvider defaultTheme="dark">
            <Router>
                <Routes>
                    <Route path="/auth" element={<AuthPage />} />
                    <Route element={<PrivateRoute />}>
                        <Route element={<AdminLayout />}>
                            <Route path="/" element={<Navigate to="/dashboard" replace />} />
                            <Route path="/dashboard" element={<DashboardPage />} />
                            <Route path="/demo" element={<DemoPage />} />
                            <Route path="/blog" element={<BlogPage />} />
                            <Route path="/account" element={<AccountPage />} />
                            <Route path="/settings" element={<SettingsPage />} />
                        </Route>
                    </Route>
                </Routes>
            </Router>
            <Toaster />
        </ThemeProvider>
    );
}
