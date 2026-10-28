import { usePrivy } from "@privy-io/react-auth";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toasts } from "./components/Chrome";
import { PlatformFooter, PlatformHeader } from "./components/PlatformChrome";
import ExplorePage from "./pages/ExplorePage";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import VaultPage from "./pages/VaultPage";

function Gate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  if (!ready) return <div className="wrap py-32 cap">Loading…</div>;
  if (!authenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <PlatformHeader />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/app" element={<Gate><Dashboard /></Gate>} />
        <Route path="/vaults/:id" element={<Gate><VaultPage /></Gate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PlatformFooter />
      <Toasts />
    </>
  );
}
