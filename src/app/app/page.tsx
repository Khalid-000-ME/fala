import { AuthGate } from "../../components/AuthGate";
import Dashboard from "../../views/Dashboard";

export default function Page() {
  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  );
}
