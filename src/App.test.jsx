import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';

// Mock fetch for backend proxy
global.fetch = vi.fn();

// Mock Firebase
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  onAuthStateChanged: vi.fn((auth, callback) => {
    // Simulate an authenticated user immediately for tests
    callback({ uid: '123', displayName: 'Test User', email: 'test@example.com' });
    return () => {}; // unsubscribe function
  }),
  signOut: vi.fn(),
}));

describe('Universal Learning AI - App Component', () => {
  beforeEach(() => {
    global.fetch.mockReset();
    global.fetch.mockImplementation((url) => {
      if (url === '/api/models') return Promise.resolve({ json: () => Promise.resolve({ models: ['gemini-pro'] }) });
      if (url === '/api/chat') return Promise.resolve({ json: () => Promise.resolve({ text: 'Mock response' }) });
      return Promise.resolve({ json: () => Promise.resolve({}) });
    });
  });

  it('renders onboarding after fake login', async () => {
    render(<App />);
    await waitFor(() => {
        expect(screen.getByText(/Ready to learn, Test/i)).toBeInTheDocument();
    });
  });
});
