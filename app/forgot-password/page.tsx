import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default function ForgotPasswordPage() {
  return <AuthShell title="Reset your password" description="Enter your account email and we’ll send a secure reset link." footer={<p>Remembered it? <Link href="/login">Return to sign in</Link></p>}><AuthForm mode="forgot" /></AuthShell>;
}
