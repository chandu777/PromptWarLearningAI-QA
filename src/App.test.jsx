import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

// Mock the environment variable
vi.stubEnv('VITE_GEMINI_API_KEY', '');

// Mock the Gemini API module to prevent actual network calls during tests
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn().mockResolvedValue({
        response: { text: () => 'Mocked AI Response' }
      })
    }))
  }))
}));

// Mock fetch for the dynamic model loading
global.fetch = vi.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({
      models: [
        { name: 'models/gemini-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] }
      ]
    })
  })
);

describe('Universal Learning AI - App Component', () => {
  
  it('renders the initial onboarding screen correctly', () => {
    render(<App />);
    expect(screen.getByText(/Welcome! Let's personalize your path./i)).toBeInTheDocument();
    expect(screen.getByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('Intermediate')).toBeInTheDocument();
    expect(screen.getByText('Expert')).toBeInTheDocument();
  });

  it('progresses to setup screen if no API key is in .env', () => {
    render(<App />);
    const beginnerBtn = screen.getByText('Beginner');
    fireEvent.click(beginnerBtn);
    
    // Check if it moved to setup step
    expect(screen.getByText(/Just one more step/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Paste your Gemini API Key here')).toBeInTheDocument();
  });

  it('progresses from setup to chat when a mock key is entered', async () => {
    render(<App />);
    // Step 1: Click Beginner
    fireEvent.click(screen.getByText('Beginner'));
    
    // Step 2: Enter API Key and Submit
    const input = screen.getByPlaceholderText('Paste your Gemini API Key here');
    fireEvent.change(input, { target: { value: 'fake-api-key' } });
    
    const startBtn = screen.getByText('Start Learning →');
    fireEvent.click(startBtn);

    // Wait for the fetch call and transition to Chat UI
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask me to explain any concept...')).toBeInTheDocument();
    });
    
    // Verify greeting message and dynamic model string
    expect(screen.getByText(/Hi! I'm your AI Learning Assistant/i)).toBeInTheDocument();
    expect(screen.getByText(/gemini-1.5-flash/i)).toBeInTheDocument();
  });

});
