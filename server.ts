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
function getDB(req: express.Request): any {
  return (req.app.locals as any).env?.DB || (process.env as any).DB;
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

export default app;
