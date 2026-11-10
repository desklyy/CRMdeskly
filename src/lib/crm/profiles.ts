/**
 * Calcula las iniciales de perfil: primera letra del nombre + primera letra
 * del primer apellido (ej. "Noé" + "Hidalgo" -> "NH").
 */
export function computeAvatarInitials(
  firstName: string,
  lastName?: string | null
): string {
  const f = firstName.trim();
  const l = (lastName ?? "").trim();

  if (f && l) {
    return `${f[0]}${l[0]}`.toUpperCase();
  }
  if (f) {
    const parts = f.split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return f.slice(0, 2).toUpperCase();
  }
  return "US";
}

export function buildFullName(firstName: string, lastName?: string | null): string {
  return [firstName.trim(), (lastName ?? "").trim()].filter(Boolean).join(" ");
}

