import React from "react";

interface DesklyLogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Renderiza el logotipo original adjuntado por Deskly (`public/logo-deskly.jpg`)
 * sin transformaciones vectoriales.
 */
export function DesklyLogo({ size = "md", className = "" }: DesklyLogoProps) {
  const sizeClass =
    size === "lg" ? "h-16 w-16" : size === "sm" ? "h-8 w-8" : "h-9 w-9";

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-deskly.jpg"
      alt="Deskly"
      className={`shrink-0 rounded-[4px] object-cover ${sizeClass} ${className}`}
    />
  );
}
