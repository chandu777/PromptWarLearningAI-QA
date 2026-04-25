import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
// Google Cloud Run requires listening on port 8080 (or process.env.PORT)
const PORT = process.env.PORT || 8080;

// ── Security: Strict payload size limit (prevents large prompt injection attacks) ──
app.use(express.json({ limit: '50kb' }));

// ── Security: Strict CORS — only allow requests from our own domains ────────
const ALLOWED_ORIGINS = [
    'https://ai-learning-app-155641208835.asia-east1.run.app',
    'http://localhost:5173',
    'http://localhost:8080',
];
app.use(cors({
    origin: (origin, callback) => {
        // Allow server-to-server requests (no origin) and whitelisted domains
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            log.warn('CORS blocked request from unauthorized origin', { origin });
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));

// ── Security: Rate Limiter — max 30 API calls per minute per IP ──────────────
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        log.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
        res.status(429).json({ error: 'Too many requests. Please slow down and try again in a minute.' });
    },
});
app.use('/api/', apiLimiter);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Google Cloud Structured Logging ─────────────────────────────────────────
// Cloud Run automatically ingests structured JSON logs into Google Cloud Logging
const log = {
    info: (msg, data = {}) => console.log(JSON.stringify({ severity: 'INFO', message: msg, ...data })),
    warn: (msg, data = {}) => console.log(JSON.stringify({ severity: 'WARNING', message: msg, ...data })),
    error: (msg, data = {}) => console.log(JSON.stringify({ severity: 'ERROR', message: msg, ...data })),
};

// SECURITY: The API Key is securely loaded from server memory / Cloud Secret Manager
const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
    log.error('CRITICAL SECURITY ERROR: Gemini API Key is missing on the backend.');
}

// ── Request Logger Middleware (visible in Google Cloud Logging) ──────────────
app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) {
        log.info('Incoming API request', { method: req.method, path: req.path });
    }
    next();
});

// ── Security: Model Whitelist — only allow requests for known valid models ────
// This list is refreshed at startup from the Google API to stay current
let ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro']);

const refreshAllowedModels = async () => {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        if (!data.error) {
            ALLOWED_MODELS = new Set(
                data.models
                    .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''))
            );
            log.info('Model whitelist refreshed', { count: ALLOWED_MODELS.size });
        }
    } catch (e) {
        log.warn('Could not refresh model whitelist, using defaults', { error: e.message });
    }
};

// Refresh once at startup
refreshAllowedModels();

const MAX_PROMPT_LENGTH = 8000;
const MAX_TOPICS_COUNT = 50;

const validateChatPayload = (selectedModel, finalPrompt) => {
    if (!selectedModel || typeof selectedModel !== 'string') return 'Invalid model specified.';
    if (!ALLOWED_MODELS.has(selectedModel)) return `Model '${selectedModel}' is not permitted.`;
    if (!finalPrompt || typeof finalPrompt !== 'string') return 'Prompt is required.';
    if (finalPrompt.length > MAX_PROMPT_LENGTH) return `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters.`;
    return null;
};

// Dynamically fetch all available models from the Google API
const getAvailableModels = async () => {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.models
            .filter(m => m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace('models/', ''))
            // Prefer flash models first (faster/cheaper), then pro
            .sort((a, b) => {
                if (a.includes('flash') && !b.includes('flash')) return -1;
                if (!a.includes('flash') && b.includes('flash')) return 1;
                return 0;
            });
    } catch (e) {
        log.error('Failed to fetch dynamic model list', { error: e.message });
        return ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];
    }
};

// Helper function to handle 503 demand spikes, 429 quota exhaustion, and 404 unavailable models
const generateWithRetry = async (ai, modelName, prompt) => {
    // Always use a fresh dynamic list so we never try a model that doesn't exist
    const modelFallbacks = await getAvailableModels();

    // Put the requested model first if it's in the list
    const preferred = modelFallbacks.filter(m => m === modelName);
    const rest = modelFallbacks.filter(m => m !== modelName);
    const orderedModels = [...preferred, ...rest];

    for (const currentModel of orderedModels) {
        try {
            const model = ai.getGenerativeModel({ model: currentModel });
            const result = await model.generateContent(prompt);
            if (currentModel !== modelName) {
                log.warn('Model fallback used', { requested: modelName, used: currentModel });
            }
            return result;
        } catch (error) {
            const is429 = error.message && error.message.includes('429');
            const is503 = error.message && error.message.includes('503');
            const is404 = error.message && error.message.includes('404');

            if (is429 || is404) {
                const reason = is404 ? 'not available' : 'quota exhausted';
                log.warn(`Model ${reason} — trying next`, { skipped: currentModel, reason });
                continue; // Try next model in the dynamic list
            } else if (is503) {
                log.warn('Gemini 503 — retrying same model after 2s', { model: currentModel });
                await new Promise(r => setTimeout(r, 2000));
                try {
                    const model = ai.getGenerativeModel({ model: currentModel });
                    return await model.generateContent(prompt);
                } catch (retryErr) {
                    log.warn('Retry failed — moving to next model', { model: currentModel });
                    continue;
                }
            } else {
                throw error;
            }
        }
    }
    throw new Error('All available Gemini models are currently exhausted. Please try again later or check your quota at https://ai.dev/rate-limit.');
};

/**
 * @route GET /api/models
 * @desc Retrieves available AI models dynamically based on the secure server key
 */
app.get('/api/models', async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: 'API Key missing on server.' });
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.error) throw new Error(data.error.message);

        const models = data.models
            .filter(m => m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace('models/', ''));

        log.info('Models fetched successfully', { count: models.length });
        res.json({ models });
    } catch (error) {
        log.error('Failed to fetch models', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route POST /api/chat
 * @desc Securely proxies chat requests to the Gemini API
 */
app.post('/api/chat', async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: 'API Key missing on server.' });
    try {
        const { selectedModel, finalPrompt } = req.body;

        // Security: Validate and sanitize inputs
        const validationError = validateChatPayload(selectedModel, finalPrompt);
        if (validationError) {
            log.warn('Invalid chat payload rejected', { reason: validationError });
            return res.status(400).json({ error: validationError });
        }

        const ai = new GoogleGenerativeAI(apiKey);

        const result = await generateWithRetry(ai, selectedModel, finalPrompt);
        const responseText = result.response.text();

        log.info('Chat response generated', { model: selectedModel, responseLength: responseText.length });
        res.json({ text: responseText });
    } catch (error) {
        log.error('Chat proxy error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route POST /api/recommendations
 * @desc Uses Gemini to suggest new topics based on user's past topics
 */
app.post('/api/recommendations', async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: 'API Key missing on server.' });
    try {
        const { pastTopics } = req.body;

        // Security: Validate pastTopics input
        if (pastTopics && (!Array.isArray(pastTopics) || pastTopics.length > MAX_TOPICS_COUNT)) {
            return res.status(400).json({ error: 'Invalid pastTopics payload.' });
        }

        let prompt = 'Suggest 3 interesting complex concepts to learn. Return ONLY a valid JSON array of 3 strings. Example: ["Quantum Computing", "Machine Learning", "Black Holes"]';

        if (pastTopics && pastTopics.length > 0) {
            // Security: Sanitize topic strings to prevent prompt injection
            const sanitizedTopics = pastTopics
                .map(t => String(t).substring(0, 60).replace(/[<>"{}]/g, ''))
                .join(', ');
            prompt = `The user has already learned about: ${sanitizedTopics}. 
             Suggest 3 COMPLETELY NEW, highly relevant concepts they should learn next. 
             Do NOT suggest any topics they have already learned.
             Return ONLY a valid JSON array of 3 strings. No markdown. Example: ["New Topic 1", "New Topic 2", "New Topic 3"]`;
        }

        const ai = new GoogleGenerativeAI(apiKey);

        const result = await generateWithRetry(ai, 'gemini-2.5-flash', prompt);
        let responseText = result.response.text().trim();

        if (responseText.startsWith('```json')) {
            responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        } else if (responseText.startsWith('```')) {
            responseText = responseText.replace(/```/g, '').trim();
        }

        const recommendations = JSON.parse(responseText);
        log.info('Recommendations generated', { count: recommendations.length, basedOnTopics: pastTopics?.length || 0 });
        res.json({ recommendations });
    } catch (error) {
        log.error('Recommendations error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Serve the static React production build files securely
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback for React Router
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start the secure backend server
app.listen(PORT, () => {
    log.info('Secure Backend Proxy started', { port: PORT, environment: process.env.NODE_ENV || 'development' });
});
