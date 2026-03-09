exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing RESEND_API_KEY' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { to, subject, message, fromName, pdfBase64, pdfFilename } = body;

  if (!to || !subject || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const emailPayload = {
    from: `${fromName || 'Resurfr Quotes'} <onboarding@resend.dev>`,
    to: [to],
    subject: subject,
    text: message,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <pre style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.6;color:#333;font-size:14px">${message}</pre>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="font-size:11px;color:#999">Sent via Resurfr · getresurfr.netlify.app</p>
    </div>`
  };

  // Attach PDF if provided
  if (pdfBase64 && pdfFilename) {
    emailPayload.attachments = [{ filename: pdfFilename, content: pdfBase64 }];
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: data.message || 'Resend error' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, id: data.id }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
