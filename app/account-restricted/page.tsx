import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
export default function AccountRestrictedPage(){return <AuthShell title="Workspace access restricted" description="This supplier company is suspended or no longer approved. Quote requests and company data are unavailable until a Bridge AI administrator restores access."><div className="auth-shield"><ShieldAlert size={20}/></div><p className="honesty-note">Contact your Bridge AI supplier success representative if you believe this is an error.</p><Link href="/login" className="button button-dark auth-submit">Return to sign in</Link></AuthShell>}
