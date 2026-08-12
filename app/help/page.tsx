import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
export default function HelpPage(){return <AuthShell title="Supplier help" description="For account approval, request distribution, billing or access issues, contact your Bridge-iT supplier success representative."><div className="honesty-note"><HelpCircle size={16}/>The public support ticket workflow is not enabled yet. Do not send customer personal information by email or through an unapproved channel.</div><Link href="/dashboard" className="button button-dark auth-submit">Return to workspace</Link></AuthShell>}
