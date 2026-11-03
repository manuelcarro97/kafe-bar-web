// Aviso por email al bar cuando entra una reserva online.
// Nunca lanza ni registra datos personales: un fallo de Resend no debe tumbar la reserva.

import { escapeHtml } from '../index.js';

const RESEND_TIMEOUT_MS = 10000;
const DEFAULT_PANEL_URL = 'https://your-firebase-project.web.app/admin/reservas/';

// Misma plantilla que el email del formulario de `worker/index.js`: filas alternas sobre fondo gris.
function row(label, value, shaded) {
  const background = shaded ? 'background-color:#f4f6f9;' : '';
  return `<tr>
                  <td style="padding:12px 16px;${background}border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;width:120px;">${label}</td>
                  <td style="padding:12px 16px;${background}border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
                </tr>`;
}

function buildHtml(reservation, panelUrl) {
  // Sin nombre ni teléfono: solo se ven en el panel y se borran a los 30 días.
  const { date, turn, time, tables, people, menu } = reservation;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#0d2137;padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:1px;">KAFÉ</h1>
              <p style="margin:6px 0 0;color:#3b9eff;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Nueva Reserva</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;color:#4a6080;font-size:14px;line-height:1.5;">
                Hay una reserva online pendiente de confirmar con los siguientes datos:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                ${row('Fecha', date, true)}
                ${row('Turno', turn, false)}
                ${row('Hora', time, true)}
                ${row('Personas', String(people), false)}
                ${row('Mesas', tables.join(', '), true)}
                ${row('Menú', menu ? 'Menú del día' : 'Sin menú del día', false)}
              </table>
              <p style="margin:24px 0 16px;color:#4a6080;font-size:14px;line-height:1.5;">
                Consulta los datos del cliente y confirma la reserva en el panel:
              </p>
              <a href="${panelUrl}" style="display:inline-block;padding:12px 20px;background-color:#1e6fbf;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Abrir panel de reservas</a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#0d2137;text-align:center;">
              <p style="margin:0;color:#4a6080;font-size:12px;">Este correo fue generado automáticamente desde el sistema de reservas de Kafe.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Envía el aviso con Resend. Traga cualquier error. */
export async function notifyNewReservation(env, reservation) {
  // Sin clave de Resend o sin destinatario configurados no se envía nada.
  if (!env.RESEND_API_KEY || !env.MAIL_TO) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      body: JSON.stringify({
        from: 'Reservas Kafe <onboarding@resend.dev>',
        to: env.MAIL_TO,
        subject: `${env.MAIL_SUBJECT_PREFIX ?? ''}Nueva reserva online: ${reservation.date} ${reservation.time}`,
        html: buildHtml(reservation, env.PANEL_URL ?? DEFAULT_PANEL_URL),
      }),
    });
    // Solo el código: el cuerpo de la respuesta podría repetir datos del cliente.
    if (!res.ok) console.error(`Aviso de reserva: Resend respondió ${res.status}`);
  } catch {
    console.error('Aviso de reserva: no se pudo contactar con Resend');
  }
}
