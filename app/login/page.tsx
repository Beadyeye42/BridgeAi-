import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default function LoginPage() {
  return <AuthShell title="Welcome back" description="Sign in to manage requests and quotations." footer={<p>New to Bridge AI? <Link href="/register">Register as a supplier</Link></p>}><AuthForm mode="login" /></AuthShell>;
}
