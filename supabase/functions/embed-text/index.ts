import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Initialize the Supabase AI session (only if using Supabase-managed AI)
const model = new Supabase.ai.Session('gte-small');

serve(async (req) => {
  const { text } = await req.json()

  if (!text) {
    return new Response(JSON.stringify({ error: "Missing text" }), { status: 400 })
  }

  try {
    const embedding = await model.run(text, {
      mean_pool: true,
      normalize: true,
    });

    return new Response(
      JSON.stringify({ embedding }),
      { headers: { "Content-Type": "application/json" } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
})
