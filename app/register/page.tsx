import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string; ref?: string }> }) {
  const params = await searchParams;
  const invitationToken = params.invite;
  const referralCode = params.ref?.trim().toUpperCase();
  return <AuthShell title={invitationToken ? "Join your supplier team" : "Join the supplier network"} description={invitationToken ? "Create your personal account to accept the workspace invitation." : "Create your company account first. After approval, choose coverage from 1–10 miles through to nationwide, with plans from £14.99 per month."} footer={<p>Already registered? <Link href="/login">Sign in</Link></p>}><AuthForm mode="register" invitationToken={invitationToken} referralCode={referralCode} /></AuthShell>;
}
