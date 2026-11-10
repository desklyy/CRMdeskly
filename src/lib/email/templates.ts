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
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<(iframe|object|embed|form|meta|link|base)[^>]*?>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(iframe|object|embed|form|meta|link|base)[^>]*?\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1=$2#$2')
    .replace(
      /(src)\s*=\s*(["'])\s*data:(?!image\/(?:png|jpeg|jpg|gif|webp);base64,)[\s\S]*?\2/gi,
      ""
    );

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
  const escapedGreeting = escapeHtml(greeting);

  const htmlBody = `<!DOCTYPE html>
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
<div style="line-height: 1.6; margin: 0px 0px 16px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">
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
</table>
</td>
</tr>
<tr>
<td style="padding-right: 30px; padding-bottom: 30px; padding-left: 30px;">
<div style="font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 11pt; font-weight: 600; color: rgb(0, 0, 0);">
Equipo Deskly</div>
<div style="margin-top: 4px; font-family: Aptos, Calibri, Helvetica, Arial, sans-serif; font-size: 11pt; color: rgb(22, 88, 245);">
<a href="https://desklyy.com" style="color: rgb(22, 88, 245);">desklyy.com</a></div>
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

  const textPreview = `${greeting} Muchas gracias por tu interés en Deskly. Para poder realizar el estudio de viabilidad e implementación en tu empresa, necesitamos recabar algunos datos técnicos y operativos. Completa el cuestionario en https://desklyy.com/cuestionario`;

  return {
    subject: QUESTIONNAIRE_EMAIL_SUBJECT,
    htmlBody,
    textPreview,
  };
}

