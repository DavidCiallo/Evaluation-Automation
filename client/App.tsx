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
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { WorkbenchPage } from "./pages/workbench/WorkbenchPage";
import { OrdersPage } from "./pages/orders/OrdersPage";
import { OrderDetailPage } from "./pages/orders/OrderDetailPage";
import { CustomerPage } from "./pages/customers/CustomerPage";
import { EmailsPage } from "./pages/emails/EmailsPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { StatisticsPage } from "./pages/settings/StatisticsPage";
import { AgentConfigPage } from "./pages/settings/AgentConfigPage";
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
                            <Route path="/workbench" element={<WorkbenchPage />} />
                            <Route path="/workbench/:chatId" element={<WorkbenchPage />} />
                            <Route path="/orders" element={<OrdersPage />} />
                            <Route path="/orders/:id" element={<OrderDetailPage />} />
                            <Route path="/customers" element={<CustomerPage />} />
                            <Route path="/emails" element={<EmailsPage />} />
                            <Route path="/account" element={<AccountPage />} />
                            <Route path="/statistics" element={<StatisticsPage />} />
                            <Route path="/agent-config" element={<AgentConfigPage />} />
                            <Route path="/settings" element={<SettingsPage />} />
                        </Route>
                    </Route>
                </Routes>
            </Router>
            <Toaster />
        </ThemeProvider>
    );
}
