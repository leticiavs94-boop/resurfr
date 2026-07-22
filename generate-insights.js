// ── 2. Pull the last 90 days of business data ──
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: quotes }, { data: jobs }, { data: invoices }, { data: profile }] =
      await Promise.all([
        supabase
          .from("quotes")
          .select("id, client_name, client_email, title, status, tax, cost_materials, cost_labor, cost_other, decline_reason, created_at, sent_at, job_date")
          .eq("user_id", userId)
          .gte("created_at", since),
        supabase
          .from("jobs")
          .select("*")
          .eq("user_id", userId)
          .gte("created_at", since),
        supabase
          .from("invoices")
          .select("*")
          .eq("user_id", userId)
          .gte("created_at", since),
        supabase
          .from("business_profiles")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

    const businessName = profile?.business_name || profile?.name || "your business";
    const num = (v) => Number(v) || 0;

    // ── 3. Build a compact summary for Claude ──
    const summary = {
      business_name: businessName,
      today: new Date().toISOString().slice(0, 10),
      quotes: (quotes || []).map((q) => ({
        id: q.id,
        client: q.client_name,
        email: q.client_email || null,
        title: q.title,
        amount: num(q.cost_materials) + num(q.cost_labor) + num(q.cost_other) + num(q.tax),
        status: q.status,
        decline_reason: q.decline_reason || null,
        created: q.created_at?.slice(0, 10),
        sent: q.sent_at?.slice(0, 10) || null,
        job_date: q.job_date || null,
      })),
      jobs: (jobs || []).map((j) => ({
        client: j.client_name || j.client || null,
        amount: num(j.total) || num(j.amount) ||
                num(j.cost_materials) + num(j.cost_labor) + num(j.cost_other),
        status: j.status || null,
        created: j.created_at?.slice(0, 10),
      })),
      invoices: (invoices || []).map((v) => ({
        client: v.client_name || v.client || null,
        amount: num(v.total) || num(v.amount) || 0,
        status: v.status || null,
        due: (v.due_date || v.due_at || "").slice(0, 10) || null,
        created: v.created_at?.slice(0, 10),
      })),
    };
