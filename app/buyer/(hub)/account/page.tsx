import { BuyerAccountForm } from "@/components/buyer/buyer-account-form";
import { getBuyerProfile } from "@/lib/buyer/data";

export default async function BuyerAccountPage() {
  const profile = await getBuyerProfile();
  return <><header className="buyer-page-head"><p className="eyebrow">Privacy and preferences</p><h1>Account</h1><p>Keep your defaults current. Your WhatsApp identity remains the authoritative buyer record.</p></header><section className="buyer-panel buyer-account-panel"><h2>Buyer details</h2><BuyerAccountForm initial={{ companyName: profile.companyName ?? "", postcode: profile.postcode ?? "", buyerType: profile.buyerType ?? "CONSUMER", whatsappUpdates: profile.whatsappUpdates, emailUpdates: profile.emailUpdates }} /><div className="buyer-security-note"><h3>Trusted device</h3><p>This device remains signed in for up to 30 days from the last verified WhatsApp link. Signing out revokes this device grant and ends the Supabase session immediately.</p></div></section></>;
}
