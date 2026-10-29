import express from 'express';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { findInEncyclopedia } from './src/data/fragranceEncyclopedia';
import { searchAndExtractWebPerfume } from './src/services/webFragranceSearch';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Helper to get D1 DB from Express Request or App locals
function getDB(req: express.Request): any {
  return (req.app.locals as any).env?.DB || (process.env as any).DB;
}

// Lazy initialize Gemini client
function getGeminiClient(req: express.Request): GoogleGenAI | null {
  const env = (req.app.locals as any).env || process.env;
  const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    appName: 'Kprime',
    geminiAvailable: !!process.env.GEMINI_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// 1. D1 Database Based History Endpoints
// ==========================================
app.get('/api/history', async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.json({ history: [], count: 0 });
    const { results } = await db.prepare("SELECT * FROM user_data ORDER BY created_at DESC").all();
    res.json({ history: results || [], count: results?.length || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch history' });
  }
});

app.post('/api/history', async (req, res) => {
  try {
    const db = getDB(req);
    const newFormula = req.body;
    if (!newFormula || typeof newFormula !== 'object') {
      return res.status(400).json({ error: 'Valid formula object required.' });
    }

    const id = newFormula.id || `form_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const contentStr = JSON.stringify(newFormula);

    if (db) {
      await db.prepare(
        "INSERT INTO user_data (username, content) VALUES (?, ?)"
      ).bind(id, contentStr).run();
    }

    res.json({ success: true, formula: { ...newFormula, id }, count: 1 });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to save formula' });
  }
});

// ==========================================
// Intelligent PDF text parsing with Gemini AI
// ==========================================
app.post('/api/gemini/parse-pdf-text', async (req, res) => {
  try {
    const { rawText } = req.body;
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return res.status(400).json({ error: 'rawText string is required in request body.' });
    }

    const ai = getGeminiClient(req);
    if (!ai) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
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
    res.json({ perfumes: parsedJson, count: parsedJson.length });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to parse text with AI' });
  }
});

// ==========================================
// Similar Perfume Research Endpoint
// ==========================================
app.post('/api/similar-perfume/research', async (req, res) => {
  try {
    const { perfumeName } = req.body;
    if (!perfumeName || typeof perfumeName !== 'string' || !perfumeName.trim()) {
      return res.status(400).json({ error: 'perfumeName string is required.' });
    }

    const trimmedQuery = perfumeName.trim();
    const encyclopediaMatch = findInEncyclopedia(trimmedQuery);
    if (encyclopediaMatch) {
      return res.json({
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
        return res.json({ profile: { ...webProfile, query: trimmedQuery }, source: 'live-web-search' });
      }
    } catch (e) {}

    return res.status(404).json({
      error: `Perfume not confidently identified. Try adding the brand name.`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to research perfume profile.' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kprime Perfume Server running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
