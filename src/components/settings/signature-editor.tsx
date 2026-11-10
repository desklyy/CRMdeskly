"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bold,
  CheckCircle2,
  Code2,
  Eraser,
  ImagePlus,
  Italic,
  Link2,
  Trash2,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMyEmailSignatureAction } from "@/app/(crm)/actions/outlook";
import { sanitizeSignatureHtml } from "@/lib/email/templates";

interface SignatureEditorProps {
  initialSignature: string | null;
}

const FONT_SIZES = ["11px", "12px", "14px", "16px", "18px", "22px"];

function resizeImageFileToDataUrl(file: File, maxDim = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.onload = () => {
      const src = String(reader.result || "");
      const img = new Image();
      img.onerror = () => reject(new Error("Formato de imagen no válido."));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const isPngOrWebp = file.type === "image/png" || file.type === "image/webp";
        const out = isPngOrWebp
          ? canvas.toDataURL("image/png")
          : canvas.toDataURL("image/jpeg", 0.88);
        resolve(out);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export function SignatureEditor({ initialSignature }: SignatureEditorProps) {
  const [html, setHtml] = useState<string>(initialSignature ?? "");
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageWidth, setImageWidth] = useState("140");
  const [linkPanelOpen, setLinkPanelOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [textColor, setTextColor] = useState("#0F172A");

  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setHtml(initialSignature ?? "");
  }, [initialSignature]);

  useEffect(() => {
    if (mode === "visual" && editorRef.current && editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
  }, [mode, html]);

  function syncFromDom() {
    if (editorRef.current) {
      setHtml(editorRef.current.innerHTML);
    }
  }

  function execFormat(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncFromDom();
  }

  function applyFontSize(sizePx: string) {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand("fontSize", false, "7");
    const fontEls = editorRef.current.querySelectorAll('font[size="7"]');
    fontEls.forEach((fontEl) => {
      const span = document.createElement("span");
      span.style.fontSize = sizePx;
      span.innerHTML = fontEl.innerHTML;
      fontEl.replaceWith(span);
    });
    syncFromDom();
  }

  function insertImageHtml(src: string) {
    const widthNum = Math.min(600, Math.max(20, Number(imageWidth) || 140));
    const safeSrc = src.replace(/"/g, "&quot;");
    const imgTag = `<img src="${safeSrc}" alt="Firma" width="${widthNum}" style="width:${widthNum}px;max-width:100%;height:auto;display:block;margin:6px 0;" />`;

    if (mode === "html") {
      setHtml((prev) => `${prev}${prev ? "\n" : ""}${imgTag}`);
    } else if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand("insertHTML", false, imgTag);
      syncFromDom();
    }
    setImageUrl("");
    setImagePanelOpen(false);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFeedback(null);
    try {
      const dataUrl = await resizeImageFileToDataUrl(file);
      insertImageHtml(dataUrl);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "No se pudo procesar la imagen.",
      });
    }
  }

  function handleInsertLink(e: React.FormEvent) {
    e.preventDefault();
    const url = linkUrl.trim();
    if (!url) return;
    if (mode === "html") {
      const safeUrl = url.replace(/"/g, "&quot;");
      setHtml(
        (prev) =>
          `${prev}<a href="${safeUrl}" style="color:#1658F5;">${safeUrl}</a>`
      );
    } else {
      execFormat("createLink", url);
    }
    setLinkPanelOpen(false);
    setLinkUrl("https://");
  }

  async function handleSave(nextHtml: string) {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await updateMyEmailSignatureAction(nextHtml);
      if (res.error) {
        setFeedback({ type: "error", text: res.error });
        return;
      }
      const saved = res.data ?? "";
      setHtml(saved);
      if (editorRef.current) editorRef.current.innerHTML = saved;
      setFeedback({
        type: "success",
        text: saved
          ? "Firma guardada en tu cuenta. Se incluirá en los emails que envíes desde el CRM."
          : "Firma eliminada de tu cuenta.",
      });
    } finally {
      setSaving(false);
    }
  }

  const sanitizedPreview = useMemo(() => sanitizeSignatureHtml(html), [html]);

  return (
    <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-[30px] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-bold tracking-[-0.02em] text-[#0F172A]">
            Firma de email personal
          </h2>
          <p className="text-xs text-[#64748B]">
            Se añade automáticamente al final de los emails y presupuestos que envíes desde
            Negocios. Admite texto enriquecido (negrita, cursiva, tamaños, colores, enlaces),
            imágenes y código HTML.
          </p>
        </div>

        <div className="flex items-center rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-0.5">
          <button
            type="button"
            onClick={() => setMode("visual")}
            className={`rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${
              mode === "visual"
                ? "bg-[#1658F5] text-white"
                : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            Editor visual
          </button>
          <button
            type="button"
            onClick={() => setMode("html")}
            className={`inline-flex items-center gap-1 rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${
              mode === "html"
                ? "bg-[#1658F5] text-white"
                : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            HTML
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-1.5">
        {mode === "visual" && (
          <>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => execFormat("bold")}
              title="Negrita"
              className="rounded-[4px] p-1.5 text-[#334155] hover:bg-[#E2E8F0]"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => execFormat("italic")}
              title="Cursiva"
              className="rounded-[4px] p-1.5 text-[#334155] hover:bg-[#E2E8F0]"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => execFormat("underline")}
              title="Subrayado"
              className="rounded-[4px] p-1.5 text-[#334155] hover:bg-[#E2E8F0]"
            >
              <Underline className="h-3.5 w-3.5" />
            </button>

            <span className="mx-1 h-4 w-px bg-[#E2E8F0]" />

            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) applyFontSize(e.target.value);
                e.target.value = "";
              }}
              title="Tamaño de letra"
              className="h-7 rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-xs text-[#334155]"
            >
              <option value="" disabled>
                Tamaño
              </option>
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <label
              title="Color de texto"
              className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[4px] border border-[#E2E8F0] bg-white px-1.5 text-xs text-[#334155]"
            >
              <span>Color</span>
              <input
                type="color"
                value={textColor}
                onChange={(e) => {
                  setTextColor(e.target.value);
                  execFormat("foreColor", e.target.value);
                }}
                className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
              />
            </label>

            <span className="mx-1 h-4 w-px bg-[#E2E8F0]" />
          </>
        )}

        <button
          type="button"
          onClick={() => {
            setLinkPanelOpen((v) => !v);
            setImagePanelOpen(false);
          }}
          className="inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-xs font-medium text-[#334155] hover:bg-[#E2E8F0]"
        >
          <Link2 className="h-3.5 w-3.5" />
          Enlace
        </button>

        <button
          type="button"
          onClick={() => {
            setImagePanelOpen((v) => !v);
            setLinkPanelOpen(false);
          }}
          className="inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-xs font-medium text-[#334155] hover:bg-[#E2E8F0]"
        >
          <ImagePlus className="h-3.5 w-3.5" />
          Imagen
        </button>

        {mode === "visual" && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execFormat("removeFormat")}
            title="Limpiar formato de selección"
            className="ml-auto inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-xs text-[#64748B] hover:bg-[#E2E8F0] hover:text-[#0F172A]"
          >
            <Eraser className="h-3.5 w-3.5" />
            Limpiar formato
          </button>
        )}
      </div>

      {/* Insert link drawer */}
      {linkPanelOpen && (
        <form
          onSubmit={handleInsertLink}
          className="flex flex-wrap items-center gap-2 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 text-xs"
        >
          <Input
            required
            placeholder="https://desklyy.com o mailto:..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            className="h-8 flex-1 min-w-[200px]"
          />
          <Button type="submit" size="sm">
            Insertar enlace
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLinkPanelOpen(false)}
          >
            Cancelar
          </Button>
        </form>
      )}

      {/* Insert image drawer */}
      {imagePanelOpen && (
        <div className="space-y-2 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[#334155]">Ancho (px):</label>
            <Input
              type="number"
              min="20"
              max="600"
              value={imageWidth}
              onChange={(e) => setImageWidth(e.target.value)}
              className="h-8 w-24"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => void handleFileSelected(e)}
              className="hidden"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#1658F5] text-white hover:bg-[#1246C8]"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Subir desde ordenador
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="O pega URL pública de imagen (https://...)"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className="h-8 flex-1 min-w-[220px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!imageUrl.trim()}
              onClick={() => insertImageHtml(imageUrl.trim())}
            >
              Insertar URL
            </Button>
          </div>
        </div>
      )}

      {/* Editor surface */}
      {mode === "visual" ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={syncFromDom}
          data-placeholder="Escribe tu firma (ej. Un saludo, Noé Hidalgo · Deskly)..."
          className="min-h-[150px] rounded-[4px] border border-[#E2E8F0] bg-white p-3 text-sm text-[#0F172A] focus:border-[#1658F5] focus:outline-none empty:before:text-[#64748B] empty:before:content-[attr(data-placeholder)]"
        />
      ) : (
        <textarea
          rows={7}
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          placeholder='<p><strong>Noé Hidalgo</strong><br/><em>Deskly</em></p><img src="https://desklyy.com/assets/logo.jpg" width="48" />'
          className="w-full rounded-[4px] border border-[#E2E8F0] bg-white p-3 font-mono text-xs text-[#0F172A] focus:border-[#1658F5] focus:outline-none"
        />
      )}

      {/* Live Preview */}
      {sanitizedPreview && (
        <div className="rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
            Vista previa al pie del email
          </p>
          <div className="rounded-[4px] border border-[#E2E8F0] bg-white p-3">
            <p className="text-xs italic text-[#64748B]">[Cuerpo de tu email...]</p>
            <div
              className="mt-3 border-t border-[#E2E8F0] pt-3 text-[13px] leading-relaxed text-[#334155]"
              dangerouslySetInnerHTML={{ __html: sanitizedPreview }}
            />
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`flex items-start gap-2 rounded-[4px] border border-[#E2E8F0] border-l-[3px] bg-[#F8FAFC] p-3 text-xs ${
            feedback.type === "error"
              ? "border-l-red-600 text-red-700"
              : "border-l-emerald-600 text-[#0F172A]"
          }`}
        >
          {feedback.type === "error" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => void handleSave(html)}
          className="bg-[#1658F5] text-white hover:bg-[#1246C8]"
        >
          {saving ? "Guardando..." : "Guardar firma"}
        </Button>

        {html.trim() && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => void handleSave("")}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar firma
          </Button>
        )}
      </div>
    </div>
  );
}

