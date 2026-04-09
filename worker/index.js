const RESEND_TIMEOUT_MS = 10000;

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "https://kaferestaurant.com",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const { nombre, telefono, fecha, hora, personas, tipo } = await request.json();

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
          subject: `Nueva Reserva: ${nombre} — ${fecha}`,
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
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${nombre}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Teléfono</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${telefono}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Fecha</td>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${fecha}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Hora</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${hora}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Personas</td>
                  <td style="padding:12px 16px;background-color:#f4f6f9;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${personas}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#4a6080;font-size:13px;">Tipo</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e8ecf2;color:#0d2137;font-size:14px;font-weight:600;">${tipo}</td>
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
        return Response.json({ error: data.error.message }, {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "https://kaferestaurant.com" },
        });
      }

      return Response.json({ success: true }, {
        headers: { "Access-Control-Allow-Origin": "https://kaferestaurant.com" },
      });
    } catch (error) {
      return Response.json({ error: error.message }, {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "https://kaferestaurant.com" },
      });
    }
  },
};
