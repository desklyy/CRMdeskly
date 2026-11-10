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

