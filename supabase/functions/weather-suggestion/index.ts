import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const environmentKeys = [
  'temperature',
  'apparentTemperature',
  'humidity',
  'precipitation',
  'weatherCode',
  'cloudCover',
  'pressure',
  'visibility',
  'windSpeed',
  'aqi',
  'pm25',
  'pm10',
] as const;

function isEnvironment(value: unknown): value is Record<string, number | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const readings = value as Record<string, unknown>;
  return (
    environmentKeys.every(
      key =>
        typeof readings[key] === 'number' && Number.isFinite(readings[key]),
    ) &&
    (readings.uvIndex === null ||
      (typeof readings.uvIndex === 'number' &&
        Number.isFinite(readings.uvIndex)))
  );
}

function respond(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return respond(405, { error: 'Method not allowed.' });
  }

  const authorization = request.headers.get('Authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return respond(401, { error: 'Sign in to request a suggestion.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const groqApiKey = Deno.env.get('GROQ_API_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !groqApiKey) {
    return respond(500, { error: 'Suggestion service is not configured.' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(
    token,
  );
  if (authError || !authData.user) {
    return respond(401, { error: 'Your session is invalid or expired.' });
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 4096) {
    return respond(413, { error: 'Suggestion context is too large.' });
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (body.length > 4096) {
      return respond(413, { error: 'Suggestion context is too large.' });
    }
    payload = JSON.parse(body);
  } catch {
    return respond(400, { error: 'Request body must be valid JSON.' });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return respond(400, { error: 'Environmental context is required.' });
  }

  const input = (payload as Record<string, unknown>).environment;
  if (!isEnvironment(input)) {
    return respond(400, { error: 'Environmental readings are incomplete.' });
  }

  const environment = Object.fromEntries(
    [...environmentKeys, 'uvIndex'].map(key => [key, input[key]]),
  );

  let groqResponse: Response;
  try {
    groqResponse = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.4,
          max_tokens: 120,
          messages: [
            {
              role: 'system',
              content:
                'Give one short, simple, practical environmental-care suggestion based on the provided current weather and air-quality readings. Do not diagnose, prescribe, or claim certainty. Mention that this is general information, not medical advice. If readings are poor, suggest reducing exposure and following the user’s existing clinician-provided plan.',
            },
            {
              role: 'user',
              content: JSON.stringify({ environment }),
            },
          ],
        }),
      },
    );
  } catch {
    return respond(502, { error: 'Could not reach the suggestion service.' });
  }

  if (!groqResponse.ok) {
    return respond(502, { error: 'The suggestion service returned an error.' });
  }

  let suggestion: string | undefined;
  try {
    const result = await groqResponse.json();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      suggestion = content.trim().slice(0, 600);
    }
  } catch {
    return respond(502, {
      error: 'The suggestion service returned invalid data.',
    });
  }
  if (!suggestion) {
    return respond(502, {
      error: 'The suggestion service returned no suggestion.',
    });
  }

  return respond(200, { suggestion });
});
