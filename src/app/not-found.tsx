import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-950">Página no encontrada</h1>
      <p className="mt-1 text-sm text-slate-500">
        El recurso que buscas no existe o ha cambiado de ruta.
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex h-9 items-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800"
      >
        Volver al Dashboard
      </Link>
    </main>
  );
}

