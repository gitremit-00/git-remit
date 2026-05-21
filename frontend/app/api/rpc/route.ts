const RPC_URL = process.env.MORPH_RPC_URL ?? "https://rpc-hoodi.morph.network";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("RPC upstream error:", response.status, text);
      return new Response(JSON.stringify({ error: "RPC upstream error", status: response.status }), { status: 502 });
    }

    const data = await response.json();
    return Response.json(data);
  } catch (err: unknown) {
    console.error("RPC proxy error:", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
