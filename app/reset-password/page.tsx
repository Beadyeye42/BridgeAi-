import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default async function ResetPasswordPage() {
  return <AuthShell title="Choose a new password" description="This will sign you out of all other Bridge AI sessions."><AuthForm mode="reset" /></AuthShell>;
}
