import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: { default: "Bridge AI — Supplier Portal", template: "%s · Bridge AI" },
    description: "Qualified customer enquiries, matched to approved suppliers through WhatsApp.",
    applicationName: "Bridge AI",
    authors: [{ name: "Ironbridge Group Ltd" }],
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "Bridge AI — Supplier Portal", description: "Qualified enquiries. Better supplier matches.", siteName: "Bridge AI", type: "website", images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: "Bridge AI supplier portal" }] },
    twitter: { card: "summary_large_image", title: "Bridge AI — Supplier Portal", description: "Qualified enquiries. Better supplier matches.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
