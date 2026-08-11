import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthHashBridge } from "@/components/auth/auth-hash-bridge";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: { default: "Bridge AI — The AI sourcing network", template: "%s · Bridge AI" },
    description: "Tell Bridge AI what you need on WhatsApp. Messages, photos, drawings and documents become matched requests for approved businesses.",
    applicationName: "Bridge AI",
    authors: [{ name: "Ironbridge Group Ltd" }],
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "Need it? Bridge it. | Bridge AI", description: "The AI sourcing network built around WhatsApp. Tell us what you need, where and when.", siteName: "Bridge AI", type: "website", images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: "Bridge AI — the AI sourcing network" }] },
    twitter: { card: "summary_large_image", title: "Need it? Bridge it. | Bridge AI", description: "The AI sourcing network built around WhatsApp. Tell us what you need, where and when.", images: [`${origin}/og.png`] },
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
