const RESEND_TIMEOUT_MS = 10000;
const ALLOWED_ORIGIN = "https://kaferestaurant.com";

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function validateInput({ nombre, telefono, fecha, hora, personas, tipo }) {
  if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.length > 100)
    return 'nombre inválido';
  if (!telefono || !/^\d{9}$/.test(String(telefono).replace(/\s+/g, '')))
    return 'telefono inválido';
  if (!fecha || !/^\d{2}-\d{2}-\d{4}$/.test(String(fecha)))
    return 'fecha inválida';
  if (!hora || !/^\d{2}:\d{2}$/.test(String(hora)))
    return 'hora inválida';
  const p = Number(personas);
  if (!Number.isInteger(p) || p < 1 || p > 20)
    return 'personas inválido';
  if (tipo !== 'De Karta' && tipo !== 'Menú personalizado')
    return 'tipo inválido';
  return null;
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
          "Vary": "Origin",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let nombre, telefono, fecha, hora, personas, tipo;
    try {
      ({ nombre, telefono, fecha, hora, personas, tipo } = await request.json());
    } catch {
      return Response.json({ error: "Petición inválida" }, {
        status: 400,
        headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Vary": "Origin" },
      });
    }

    const validationError = validateInput({ nombre, telefono, fecha, hora, personas, tipo });
    if (validationError) {
      return Response.json({ error: validationError }, {
        status: 400,
        headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Vary": "Origin" },
      });
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        body: JSON.stringify({
          from: "Reservas Kafe <onboarding@resend.dev>",
          to: "reservaskafebar@gmail.com",
          subject: `Nueva Reserva: ${escapeHtml(nombre)} — ${escapeHtml(fecha)}`,
          html: `
<!DOCTYPE html>
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
                Se ha recibido una nueva solicitud de reserva con los siguientes datos:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;width:120px;">Nombre</td>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(nombre)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Teléfono</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(telefono)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Fecha</td>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(fecha)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Hora</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(hora)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Personas</td>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(String(personas))}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Tipo</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${escapeHtml(tipo)}</td>
                </tr>
              </table>
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
</html>`,
        }),
      });

      const data = await res.json();

      if (data.error) {
        return Response.json({ error: "Error al enviar la reserva" }, {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            "Vary": "Origin",
          },
        });
      }

      return Response.json({ success: true }, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Vary": "Origin",
        },
      });
    } catch {
      return Response.json({ error: "Error al procesar la reserva" }, {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Vary": "Origin",
        },
      });
    }
  },
};
