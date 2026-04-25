import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
// Google Cloud Run requires listening on port 8080 (or process.env.PORT)
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SECURITY: The API Key is securely loaded from server memory / Cloud Secret Manager
const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
    console.error("CRITICAL SECURITY ERROR: Gemini API Key is missing on the backend.");
}

/**
 * @route GET /api/models
 * @desc Retrieves available AI models dynamically based on the secure server key
 */
app.get('/api/models', async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: "API Key missing on server." });
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.error) throw new Error(data.error.message);

        const models = data.models
            .filter(m => m.supportedGenerationMethods.includes("generateContent"))
            .map(m => m.name.replace('models/', ''));

        res.json({ models });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route POST /api/chat
 * @desc Securely proxies chat requests to the Gemini API
 */
app.post('/api/chat', async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: "API Key missing on server." });
    try {
        const { selectedModel, finalPrompt } = req.body;

        if (!selectedModel || !finalPrompt) {
            return res.status(400).json({ error: "Invalid request payload. Model and Prompt are required." });
        }

        const ai = new GoogleGenerativeAI(apiKey);
        const model = ai.getGenerativeModel({ model: selectedModel });

        const result = await model.generateContent(finalPrompt);
        const responseText = result.response.text();

        res.json({ text: responseText });
    } catch (error) {
        console.error("Backend Proxy Error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route POST /api/recommendations
 * @desc Uses Gemini to suggest new topics based on user's past topics
 */
app.post('/api/recommendations', async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: "API Key missing on server." });
    try {
        const { pastTopics } = req.body;

        let prompt = "Suggest 3 interesting complex concepts to learn. Return ONLY a valid JSON array of 3 strings. Example: [\"Quantum Computing\", \"Machine Learning\", \"Black Holes\"]";

        if (pastTopics && pastTopics.length > 0) {
            prompt = `The user has already learned about the following topics: ${pastTopics.join(', ')}. 
             Suggest 3 COMPLETELY NEW, highly relevant, and interesting concepts they should learn next. 
             Do NOT suggest any topics they have already learned.
             Return ONLY a valid JSON array of 3 strings. No markdown formatting, just the raw JSON array. Example: ["New Topic 1", "New Topic 2", "New Topic 3"]`;
        }

        const ai = new GoogleGenerativeAI(apiKey);
        // We use gemini-2.5-flash for incredibly fast recommendation generation
        const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });

        const result = await model.generateContent(prompt);
        let responseText = result.response.text().trim();

        if (responseText.startsWith('```json')) {
            responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        } else if (responseText.startsWith('```')) {
            responseText = responseText.replace(/```/g, '').trim();
        }

        const recommendations = JSON.parse(responseText);
        res.json({ recommendations });
    } catch (error) {
        console.error("Backend Proxy Recommendation Error:", error);
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
    console.log(`✅ Secure Backend Proxy running on port ${PORT}`);
});
