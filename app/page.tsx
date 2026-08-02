import { SupplierDashboard } from "@/components/dashboard/supplier-dashboard";
import { demoDashboard } from "@/lib/demo-data";

export default function Home() {
  return <SupplierDashboard data={demoDashboard} demo />;
}
