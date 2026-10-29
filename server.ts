import express from 'express';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { findInEncyclopedia } from './src/data/fragranceEncyclopedia';
import { searchAndExtractWebPerfume } from './src/services/webFragranceSearch';

dotenv.config();

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Helper to get D1 DB from Cloudflare Environment
function getDB(env: any): any {
  return env?.DB || (process.env as any).DB;
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
app.get('/api/history', async (req: any, res: any) => {
  try {
    const db = getDB(req.env);
    if (!db) return res.json({ history: [], count: 0 });
    const { results } = await db.prepare("SELECT * FROM user_data ORDER BY created_at DESC").all();
    res.json({ history: results || [], count: results?.length || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch history' });
  }
});

app.post('/api/history', async (req: any, res: any) => {
  try {
    const db = getDB(req.env);
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

// Cloudflare Worker ES Module Handler
export default {
  async fetch(request: Request, env: any, ctx: any) {
    // Attach Cloudflare env to request so Express routes can access D1 database
    (request as any).env = env;
    
    // Let Express handle the request if it's an API call
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      // Create a Node-compatible request/response bridge for Express or handle via fetch
      // For simplicity with Express on CF Workers using nodejs_compat:
      return app(request, env, ctx);
    }

    // For static assets / frontend pages, let Cloudflare Assets handle it automatically
    return env.ASSETS.fetch(request);
  }
};
