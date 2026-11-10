import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deskly CRM",
  description: "Acceso privado.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-video-preview": -1,
      "max-image-preview": "none",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[#F8FAFC] font-sans text-[#334155] antialiased">
        {children}
      </body>
    </html>
  );
}
