// ════════════════════════════════════════════════════════
// RESURFR · AI INSIGHTS — NETLIFY FUNCTION
// Path: netlify/functions/generate-insights.js
// ════════════════════════════════════════════════════════

const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // ── 1. Identify the contractor from their session token ──
  const token = (event.headers.authorization || "").replace("Bearer ", "");
  if (!token) return { statusCode: 401, body: "Missing auth token" };

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { statusCode: 401, body: "Invalid session" };
  }
  const userId = userData.user.id;

  try {
    // ── 2. Pull the last 90 days of business data ──
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // ⚠️ Adjust column names below to match YOUR schema if different
    const [{ data: quotes }, { data: jobs }, { data: profile }] =
      await Promise.all([
        supabase
          .from("quotes")
          .select("id, client_name, total, status, created_at, sent_at")
          .eq("user_id", userId)
          .gte("created_at", since),
        supabase
          .from("jobs")
          .select("id, client_name, total, status, created_at")
          .eq("user_id", userId)
          .gte("created_at", since),
        supabase
          .from("business_profile")
          .select("business_name")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

    const businessName = profile?.business_name || "your business";

    // ── 3. Build a compact summary for Claude ──
    const summary = {
      business_name: businessName,
      today: new Date().toISOString().slice(0, 10),
      quotes: (quotes || []).map((q) => ({
        id: q.id,
        client: q.client_name,
        amount: q.total,
        status: q.status,
        created: q.created_at?.slice(0, 10),
        sent: q.sent_at?.slice(0, 10) || null,
      })),
      jobs: (jobs || []).map((j) => ({
        client: j.client_name,
        amount: j.total,
        status: j.status,
        created: j.created_at?.slice(0, 10),
      })),
    };

    // ── 4. Ask Claude for insights (strict JSON out) ──
    const prompt = `You are the business analyst inside Resurfr, a job management app for small contractors.

Here is this contractor's last 90 days of data as JSON:
${JSON.stringify(summary)}

Analyze it and return 2 to 5 actionable insights. Look for:
- Quotes with status "sent" and no response for 5+ days (type "Follow-up")
- Patterns in won vs lost quotes by size (type "Quote intelligence")
- Money that should be collected or protected (type "Cash flow")
- Seasonal timing opportunities based on when jobs cluster (type "Seasonality")

Rules:
- Only claim things the data actually supports. If there is little data, return fewer insights.
- Every insight must name real clients/amounts from the data.
- For "Follow-up", "Cash flow" and "Seasonality" insights, write a ready-to-send email draft. Sign emails as "${businessName}". Keep them short, friendly, and professional.
- "title" is max 60 characters, punchy. "detail" is 1-2 sentences with the key numbers.

Respond with ONLY a raw JSON array, no markdown fences, no commentary. Each element:
{
  "type": "Follow-up" | "Quote intelligence" | "Cash flow" | "Seasonality",
  "priority": "high" | "medium",
  "title": "...",
  "detail": "...",
  "action_label": "..." or null,
  "action_type": "email" or null,
  "email_to": "..." or null,
  "email_subject": "..." or null,
  "email_body": "..." or null
}`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("Claude API error:", errText);
      return { statusCode: 502, body: "AI analysis failed" };
    }

    const aiData = await aiRes.json();
    const rawText = (aiData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    let insights;
    try {
      insights = JSON.parse(rawText.replace(/```json|```/g, "").trim());
      if (!Array.isArray(insights)) throw new Error("not an array");
    } catch (e) {
      console.error("Failed to parse AI response:", rawText);
      return { statusCode: 502, body: "AI returned invalid format" };
    }

    // ── 5. Replace old 'new' insights with the fresh batch ──
    await supabase
      .from("insights")
      .delete()
      .eq("user_id", userId)
      .eq("status", "new");

    const rows = insights.slice(0, 5).map((i) => ({
      user_id: userId,
      type: i.type || "Follow-up",
      priority: i.priority === "high" ? "high" : "medium",
      title: String(i.title || "").slice(0, 120),
      detail: String(i.detail || "").slice(0, 600),
      action_label: i.action_label || null,
      action_type: i.action_type === "email" ? "email" : null,
      email_to: i.email_to || null,
      email_subject: i.email_subject || null,
      email_body: i.email_body || null,
      status: "new",
    }));

    const { error: insErr } = await supabase.from("insights").insert(rows);
    if (insErr) {
      console.error("Insert error:", insErr);
      return { statusCode: 500, body: "Failed to save insights" };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: rows.length }),
    };
  } catch (err) {
    console.error("generate-insights failed:", err);
    return { statusCode: 500, body: "Internal error" };
  }
};
