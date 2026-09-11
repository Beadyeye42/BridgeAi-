import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthHashBridge } from "@/components/auth/auth-hash-bridge";
import "./globals.css";
import "./modern.css";
import "./customer-site.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: { default: "Bridge-iT — Find the right business for what you need", template: "%s · Bridge-iT" },
    description: "Request quotes for products and services on WhatsApp. Clarify your requirements, compare supplier offers and ask questions before choosing your next step.",
    applicationName: "Bridge-iT",
    authors: [{ name: "Ironbridge Group Ltd" }],
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "Need it? Bridge it. | Bridge-iT", description: "Good work, closer to home. Connect with local service businesses through WhatsApp.", siteName: "Bridge-iT", type: "website", images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: "Bridge-iT — the AI sourcing network" }] },
    twitter: { card: "summary_large_image", title: "Need it? Bridge it. | Bridge-iT", description: "Good work, closer to home. Connect with local service businesses through WhatsApp.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><AuthHashBridge />{children}</body>
    </html>
  );
}
