import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deskly CRM",
  description:
    "Plataforma CRM comercial interna de Deskly orientada a variables estructuradas e IA.",
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
