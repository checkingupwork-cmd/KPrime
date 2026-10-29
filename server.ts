import { GoogleGenAI, Type } from '@google/genai';
import { findInEncyclopedia } from './src/data/fragranceEncyclopedia';
import { searchAndExtractWebPerfume } from './src/services/webFragranceSearch';

// Helper for Gemini Client using Workers env binding
function getGeminiClient(env: any): GoogleGenAI | null {
  const apiKey = env?.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS headers for API requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const jsonResponse = (data: any, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    };

    try {
      // 1. Health Check
      if (url.pathname === '/api/health' && method === 'GET') {
        return jsonResponse({
          status: 'ok',
          appName: 'Kprime',
          geminiAvailable: !!env.GEMINI_API_KEY,
          timestamp: new Date().toISOString(),
        });
      }

      // 2. D1 Database History Endpoints
      if (url.pathname === '/api/history' && method === 'GET') {
        const db = env.DB;
        if (!db) return jsonResponse({ history: [], count: 0 });
        const { results } = await db.prepare("SELECT * FROM user_data ORDER BY created_at DESC").all();
        return jsonResponse({ history: results || [], count: results?.length || 0 });
      }

      if (url.pathname === '/api/history' && method === 'POST') {
        const db = env.DB;
        const newFormula = await request.json();
        if (!newFormula || typeof newFormula !== 'object') {
          return jsonResponse({ error: 'Valid formula object required.' }, 400);
        }

        const id = (newFormula as any).id || `form_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const contentStr = JSON.stringify(newFormula);

        if (db) {
          await db.prepare(
            "INSERT INTO user_data (username, content) VALUES (?, ?)"
          ).bind(id, contentStr).run();
        }

        return jsonResponse({ success: true, formula: { ...newFormula, id }, count: 1 });
      }

      // 3. Intelligent PDF text parsing with Gemini AI
      if (url.pathname === '/api/gemini/parse-pdf-text' && method === 'POST') {
        const { rawText } = await request.json() as any;
        if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
          return jsonResponse({ error: 'rawText string is required in request body.' }, 400);
        }

        const ai = getGeminiClient(env);
        if (!ai) {
          return jsonResponse({ error: 'GEMINI_API_KEY is not configured on the server.' }, 503);
        }

        const prompt = `You are a specialized perfume database importer.
Extract and parse all perfume entries from the following raw text extracted from a PDF document.
Return a clean JSON array of perfume objects with: code, name, notes, fragrance, category, description.

Raw Text:
"""
${rawText.slice(0, 50000)}
"""`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  code: { type: Type.STRING },
                  name: { type: Type.STRING },
                  notes: { type: Type.STRING },
                  fragrance: { type: Type.STRING },
                  category: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ['code', 'name'],
              },
            },
          },
        });

        const parsedJson = JSON.parse(response.text || '[]');
        return jsonResponse({ perfumes: parsedJson, count: parsedJson.length });
      }

      // 4. Similar Perfume Research Endpoint
      if (url.pathname === '/api/similar-perfume/research' && method === 'POST') {
        const { perfumeName } = await request.json() as any;
        if (!perfumeName || typeof perfumeName !== 'string' || !perfumeName.trim()) {
          return jsonResponse({ error: 'perfumeName string is required.' }, 400);
        }

        const trimmedQuery = perfumeName.trim();
        const encyclopediaMatch = findInEncyclopedia(trimmedQuery);
        if (encyclopediaMatch) {
          return jsonResponse({
            profile: {
              query: trimmedQuery,
              name: encyclopediaMatch.name,
              brand: encyclopediaMatch.brand,
              concentration: encyclopediaMatch.concentration,
              fragranceFamily: encyclopediaMatch.fragranceFamily,
              topNotes: encyclopediaMatch.topNotes,
              heartNotes: encyclopediaMatch.heartNotes,
              baseNotes: encyclopediaMatch.baseNotes,
              accords: encyclopediaMatch.accords,
              genderTarget: encyclopediaMatch.genderTarget,
              description: encyclopediaMatch.description,
              confidence: 'high',
              verified: true,
            },
            source: 'verified-encyclopedia',
          });
        }

        try {
          const webProfile = await searchAndExtractWebPerfume(trimmedQuery);
          if (webProfile) {
            return jsonResponse({ profile: { ...webProfile, query: trimmedQuery }, source: 'live-web-search' });
          }
        } catch (e) {}

        return jsonResponse({ error: `Perfume not confidently identified. Try adding the brand name.` }, 404);
      }

      // Static assets output (Vite build)
      return env.ASSETS.fetch(request);

    } catch (err: any) {
      return jsonResponse({ error: err?.message || 'Internal Server Error' }, 500);
    }
  }
};
