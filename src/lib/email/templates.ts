import { formatCurrencyEUR } from "@/lib/crm/custom-fields";

export const QUESTIONNAIRE_EMAIL_SUBJECT = "Cuestionario Operativo Deskly";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanea HTML de firma personal eliminando scripts, iframes y handlers XSS,
 * manteniendo formato enriquecido (negrita, cursiva, tamaño, color, tablas, enlaces e imágenes).
 */
export function sanitizeSignatureHtml(rawHtml: string): string {
  const trimmed = rawHtml.trim();
  if (!trimmed) return "";

  let clean = trimmed
    .replace(
      /<(script|style|iframe|object|embed|form|svg|math|noscript|template)[\s\S]*?>[\s\S]*?<\/\1>/gi,
      ""
    )
    .replace(
      /<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|option|meta|link|base|svg|math|noscript|template)\b[^>]*\/?>/gi,
      ""
    )
    // Eliminar cualquier atributo on* (con comillas dobles, simples o sin comillas)
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Eliminar atributos peligrosos como formaction / srcset / ping
    .replace(/\s+(formaction|srcset|ping|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Bloquear javascript:, vbscript: y data: no-imagen incluso con entidades o espacios intercalados
    .replace(/(href|src)\s*=\s*(["'])\s*([\s\S]*?)\2/gi, (full, attr: string, quote: string, val: string) => {
      const normalized = val
        .replace(/&#x?[0-9a-f]+;?/gi, "")
        .replace(/[\u0000-\u0020]+/g, "")
        .toLowerCase();
      if (
        normalized.startsWith("javascript:") ||
        normalized.startsWith("vbscript:")
      ) {
        return `${attr}=${quote}#${quote}`;
      }
      if (normalized.startsWith("data:")) {
        if (
          attr.toLowerCase() === "src" &&
          /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(val.trim())
        ) {
          return full;
        }
        return `${attr}=${quote}#${quote}`;
      }
      return full;
    })
    // Bloquear expresiones CSS / url(...) potencialmente peligrosas dentro de style=""
    .replace(/style\s*=\s*(["'])([\s\S]*?)\1/gi, (_full, quote: string, css: string) => {
      const safeCss = css
        .replace(/expression\s*\([^)]*\)/gi, "")
        .replace(/url\s*\([^)]*\)/gi, "")
        .replace(/-moz-binding\s*:[^;]*/gi, "")
        .replace(/behavior\s*:[^;]*/gi, "");
      return `style=${quote}${safeCss}${quote}`;
    });

  // Si solo es texto sin HTML visible, comprobar que no esté vacío tras limpiar etiquetas vacías
  const textOnly = clean
    .replace(/<img\b[^>]*>/gi, "img")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  if (!textOnly) return "";

  // Si no contiene tags HTML, convertir saltos de línea a <br />
  if (!/<[a-z][\s\S]*>/i.test(clean)) {
    clean = escapeHtml(clean).replace(/\r?\n/g, "<br />");
  }

  return clean;
}

/**
 * Añade la firma HTML del usuario al final del cuerpo de un correo HTML.
 */
export function appendSignatureToHtmlBody(
  bodyHtml: string,
  signatureHtml?: string | null
): string {
  if (!signatureHtml) return bodyHtml;
  const safeSig = sanitizeSignatureHtml(signatureHtml);
  if (!safeSig) return bodyHtml;

  return `${bodyHtml}<div style="margin-top:20px;padding-top:14px;border-top:1px solid #E2E8F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#334155;">${safeSig}</div>`;
}

export interface InlineGraphAttachment {
  name: string;
  contentType: string;
  contentBytesBase64: string;
  isInline: true;
  contentId: string;
}

/**
 * Extrae imágenes embebidas `data:image/...;base64,...` de un HTML y las convierte
 * en adjuntos inline CID compatibles con Microsoft Graph (`/me/sendMail`).
 */
export function extractInlineImagesForGraph(html: string): {
  htmlBody: string;
  inlineAttachments: InlineGraphAttachment[];
} {
  const inlineAttachments: InlineGraphAttachment[] = [];
  let counter = 0;

  const htmlBody = html.replace(
    /src=(["'])data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)\1/gi,
    (_full, quote: string, mime: string, base64: string) => {
      const idx = counter++;
      const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const contentId = `deskly-sig-${idx}@crm`;
      inlineAttachments.push({
        name: `signature-${idx}.${ext}`,
        contentType: mime.toLowerCase(),
        contentBytesBase64: base64,
        isInline: true,
        contentId,
      });
      return `src=${quote}cid:${contentId}${quote}`;
    }
  );

  return { htmlBody, inlineAttachments };
}

function wrapWithDesklyEmailShell(options: {
  greeting: string;
  bodyHtml: string;
  personalSignatureHtml?: string | null;
}): string {
  const escapedGreeting = escapeHtml(options.greeting);
  const safeSig = options.personalSignatureHtml
    ? sanitizeSignatureHtml(options.personalSignatureHtml)
    : "";
  const extraSignatureBlock = safeSig
    ? `<div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid rgb(226, 232, 240); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.5; color: rgb(51, 65, 85);">${safeSig}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style>
</head>
<body dir="ltr" style="margin:0;padding:0;background-color:#ffffff;">
<table id="table_1" cellspacing="0" cellpadding="0" border="0" style="text-align: left; width: 100%; color: rgb(0, 0, 0);">
<tbody>
<tr>
<td align="center" style="padding: 16px;">
<table id="table_2" cellspacing="0" cellpadding="0" border="0" style="border-width: 1px; border-style: solid; border-color: rgb(226, 232, 240); width: 100%; max-width: 600px;">
<tbody>
<tr>
<td style="border-bottom: 1px solid rgb(241, 245, 249); padding: 30px;">
<table id="table_0" cellspacing="0" cellpadding="0" border="0">
<tbody>
<tr>
<td style="vertical-align: middle; width: 24px; box-sizing: border-box;"><span style="font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 18pt; color: rgb(0, 0, 0);"><img alt="Deskly" id="image_0" width="47" height="47" style="width: 47px; height: 47px; display: block;" src="https://desklyy.com/assets/logo.jpg"></span></td>
<td style="padding-left: 8px; vertical-align: middle; box-sizing: border-box;">
<div style="font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 18pt; color: rgb(0, 0, 0);">
<span style="font-weight: 700;">Desk</span><span style="color: rgb(56, 121, 252); font-weight: 700;">ly</span></div>
</td>
</tr>
</tbody>
</table>
</td>
</tr>
<tr>
<td style="padding: 30px;">
<div style="line-height: 1.6; margin: 0px 0px 16px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">
${escapedGreeting}</div>
${options.bodyHtml}
</td>
</tr>
<tr>
<td style="padding-right: 30px; padding-bottom: 30px; padding-left: 30px;">
<div style="font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 11pt; font-weight: 600; color: rgb(0, 0, 0);">
Equipo Deskly</div>
<div style="margin-top: 4px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 11pt; color: rgb(22, 88, 245);">
<a href="https://desklyy.com" style="color: rgb(22, 88, 245);">desklyy.com</a></div>
${extraSignatureBlock}
</td>
</tr>
</tbody>
</table>
<div style="text-align: center; margin-top: 20px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 11pt; color: rgb(0, 0, 0);">
&copy; 2026 Deskly</div>
</td>
</tr>
</tbody>
</table>
</body>
</html>`;
}

/**
 * Construye el correo HTML de "Cuestionario Operativo Deskly" a partir de la
 * plantilla oficial (.oft), personalizando el saludo con el nombre del contacto.
 */
export function buildOperationalQuestionnaireEmail(firstName?: string | null): {
  subject: string;
  htmlBody: string;
  textPreview: string;
} {
  const cleanName = firstName?.trim() || "";
  const greeting = cleanName ? `Hola ${cleanName},` : "Hola,";

  const bodyHtml = `<div style="line-height: 1.6; margin: 0px 0px 16px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">
Muchas gracias por tu inter&eacute;s en Deskly.</div>
<div style="line-height: 1.6; margin: 0px 0px 24px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">
Para poder realizar el estudio de viabilidad e implementaci&oacute;n en tu empresa, necesitamos recabar algunos datos t&eacute;cnicos y operativos. Por favor, completa el siguiente cuestionario para que podamos dimensionar el proyecto de forma precisa.</div>
<table cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 30px;">
<tbody>
<tr>
<td align="center" style="background-color: rgb(22, 88, 245); padding: 12px 24px;">
<div style="font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 11pt; color: rgb(255, 255, 255);">
<span style="font-weight: 600;"><a href="https://desklyy.com/cuestionario" style="color: rgb(255, 255, 255); text-decoration: none; display: inline-block;">Completar cuestionario</a></span></div>
</td>
</tr>
</tbody>
</table>`;

  const htmlBody = wrapWithDesklyEmailShell({ greeting, bodyHtml });
  const textPreview = `${greeting} Muchas gracias por tu interés en Deskly. Para poder realizar el estudio de viabilidad e implementación en tu empresa, necesitamos recabar algunos datos técnicos y operativos. Completa el cuestionario en https://desklyy.com/cuestionario`;

  return {
    subject: QUESTIONNAIRE_EMAIL_SUBJECT,
    htmlBody,
    textPreview,
  };
}

export interface QuoteEmailItem {
  concept: string;
  description?: string | null;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
  line_total: number;
}

/**
 * Construye el correo HTML oficial de envío de Presupuesto con desglose de líneas
 * y totales, usando el mismo marco visual que las plantillas Deskly (logo, colores y caja ortogonal).
 */
export function buildQuoteEmailHtml(input: {
  firstName?: string | null;
  quoteNumber: string;
  dealTitle: string;
  companyName?: string | null;
  items: QuoteEmailItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  totalAmount: number;
  validUntil?: string | null;
  terms?: string | null;
  personalSignatureHtml?: string | null;
}): {
  htmlBody: string;
  textPreview: string;
} {
  const cleanName = input.firstName?.trim() || "";
  const greeting = cleanName ? `Hola ${cleanName},` : "Hola,";
  const escapedQuote = escapeHtml(input.quoteNumber);
  const escapedDeal = escapeHtml(input.dealTitle);
  const escapedCompany = input.companyName?.trim() ? escapeHtml(input.companyName.trim()) : "";
  const totalAmountFormatted = formatCurrencyEUR(input.totalAmount);
  const escapedTotal = escapeHtml(totalAmountFormatted);
  const validText = input.validUntil
    ? escapeHtml(new Date(input.validUntil).toLocaleDateString("es-ES"))
    : "";
  const escapedTerms = input.terms?.trim()
    ? escapeHtml(input.terms.trim()).replace(/\r?\n/g, "<br />")
    : "";

  const metaItems: string[] = [
    `<strong>Referencia:</strong> ${escapedQuote}`,
    `<strong>Proyecto:</strong> ${escapedDeal}`,
  ];
  if (escapedCompany) metaItems.push(`<strong>Empresa:</strong> ${escapedCompany}`);
  if (validText) metaItems.push(`<strong>V&aacute;lido hasta:</strong> ${validText}`);

  const itemRowsHtml = input.items
    .map((item) => {
      const escapedConcept = escapeHtml(item.concept);
      const escapedDesc = item.description?.trim()
        ? `<div style="margin-top: 2px; font-size: 9.5pt; color: rgb(100, 116, 139);">${escapeHtml(item.description.trim())}</div>`
        : "";
      const discountLabel =
        item.discount_percent > 0
          ? `<div style="margin-top: 2px; font-size: 9pt; color: rgb(100, 116, 139);">Dto. -${Number(item.discount_percent)}%</div>`
          : "";
      const qtyStr = Number(item.quantity).toLocaleString("es-ES", {
        maximumFractionDigits: 2,
      });
      return `<tr>
<td style="padding: 10px 8px; border-bottom: 1px solid rgb(241, 245, 249); font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10.5pt; color: rgb(15, 23, 42); vertical-align: top;">
<div style="font-weight: 600;">${escapedConcept}</div>
${escapedDesc}
</td>
<td style="padding: 10px 6px; border-bottom: 1px solid rgb(241, 245, 249); text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; color: rgb(51, 65, 85); vertical-align: top; white-space: nowrap;">${qtyStr}</td>
<td style="padding: 10px 6px; border-bottom: 1px solid rgb(241, 245, 249); text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; color: rgb(51, 65, 85); vertical-align: top; white-space: nowrap;">
${escapeHtml(formatCurrencyEUR(item.unit_price))}${discountLabel}
</td>
<td style="padding: 10px 8px; border-bottom: 1px solid rgb(241, 245, 249); text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10.5pt; font-weight: 600; color: rgb(15, 23, 42); vertical-align: top; white-space: nowrap;">${escapeHtml(formatCurrencyEUR(item.line_total))}</td>
</tr>`;
    })
    .join("");

  const netBase = Math.round((input.subtotal - input.discountTotal) * 100) / 100;
  const discountRow =
    input.discountTotal > 0
      ? `<tr>
<td colspan="3" style="padding: 4px 8px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; color: rgb(100, 116, 139);">Descuentos</td>
<td style="padding: 4px 8px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; color: rgb(51, 65, 85); white-space: nowrap;">-${escapeHtml(formatCurrencyEUR(input.discountTotal))}</td>
</tr>`
      : "";

  const termsBlock = escapedTerms
    ? `<div style="margin: 0px 0px 20px; padding: 12px 16px; border-left: 3px solid rgb(22, 88, 245); background-color: rgb(248, 250, 252); font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: rgb(51, 65, 85);">
<strong style="color: rgb(15, 23, 42);">Condiciones:</strong><br />${escapedTerms}</div>`
    : "";

  const bodyHtml = `<div style="line-height: 1.6; margin: 0px 0px 14px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">
Te enviamos el presupuesto desglosado para el proyecto <strong>${escapedDeal}</strong>:</div>
<div style="margin: 0px 0px 18px; padding: 12px 16px; border: 1px solid rgb(226, 232, 240); background-color: rgb(248, 250, 252); font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.6; color: rgb(51, 65, 85);">
${metaItems.join(" &nbsp;&middot;&nbsp; ")}
</div>
<table cellspacing="0" cellpadding="0" border="0" style="width: 100%; margin: 0px 0px 20px; border: 1px solid rgb(226, 232, 240); border-collapse: collapse;">
<thead>
<tr style="background-color: rgb(248, 250, 252); border-bottom: 1px solid rgb(226, 232, 240);">
<th align="left" style="padding: 9px 8px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 9.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: rgb(100, 116, 139);">Concepto</th>
<th align="right" style="padding: 9px 6px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 9.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: rgb(100, 116, 139); white-space: nowrap;">Cant.</th>
<th align="right" style="padding: 9px 6px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 9.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: rgb(100, 116, 139); white-space: nowrap;">Precio</th>
<th align="right" style="padding: 9px 8px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 9.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: rgb(100, 116, 139); white-space: nowrap;">Importe</th>
</tr>
</thead>
<tbody>
${itemRowsHtml}
<tr>
<td colspan="3" style="padding: 8px 8px 4px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; color: rgb(100, 116, 139);">Subtotal</td>
<td style="padding: 8px 8px 4px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; color: rgb(51, 65, 85); white-space: nowrap;">${escapeHtml(formatCurrencyEUR(input.subtotal))}</td>
</tr>
${discountRow}
<tr>
<td colspan="3" style="padding: 4px 8px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; color: rgb(100, 116, 139);">Base imponible</td>
<td style="padding: 4px 8px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; font-weight: 600; color: rgb(15, 23, 42); white-space: nowrap;">${escapeHtml(formatCurrencyEUR(netBase))}</td>
</tr>
<tr>
<td colspan="3" style="padding: 4px 8px 8px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; color: rgb(100, 116, 139);">IVA</td>
<td style="padding: 4px 8px 8px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 10pt; color: rgb(51, 65, 85); white-space: nowrap;">${escapeHtml(formatCurrencyEUR(input.taxTotal))}</td>
</tr>
<tr style="background-color: rgb(248, 250, 252); border-top: 2px solid rgb(22, 88, 245);">
<td colspan="3" style="padding: 10px 8px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 11pt; font-weight: 700; color: rgb(15, 23, 42);">TOTAL (IVA incl.)</td>
<td style="padding: 10px 8px; text-align: right; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 12.5pt; font-weight: 700; color: rgb(22, 88, 245); white-space: nowrap;">${escapedTotal}</td>
</tr>
</tbody>
</table>
${termsBlock}
<div style="line-height: 1.6; margin: 0px 0px 10px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 11.5pt; color: rgb(0, 0, 0);">
Tambi&eacute;n te adjuntamos este presupuesto en formato PDF. Quedamos a tu disposici&oacute;n para cualquier duda o ajuste.</div>`;

  const htmlBody = wrapWithDesklyEmailShell({
    greeting,
    bodyHtml,
    personalSignatureHtml: input.personalSignatureHtml,
  });

  const conceptsSummary = input.items.map((i) => i.concept).join(", ");
  const textPreview = `${greeting} Presupuesto ${input.quoteNumber} (${conceptsSummary}) · Total: ${totalAmountFormatted}.`;

  return { htmlBody, textPreview };
}

