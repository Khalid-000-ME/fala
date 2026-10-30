import { AuthGate } from "../../../components/AuthGate";
import VaultPage from "../../../views/VaultPage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthGate>
      <VaultPage id={id} />
    </AuthGate>
  );
}
