import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';

// ─── Global Mocks ───────────────────────────────────────────────────────────
global.fetch = vi.fn();

vi.mock('firebase/app', () => ({ initializeApp: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn().mockResolvedValue({ id: 'mock-session-id' }),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ forEach: vi.fn() }),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(() => new Date()),
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  signInWithPopup: vi.fn().mockResolvedValue({ user: { uid: 'user-123', displayName: 'Test User', email: 'test@example.com' } }),
  GoogleAuthProvider: vi.fn(),
  onAuthStateChanged: vi.fn((auth, callback) => {
    // Inline the mock object - cannot use top-level variables in vi.mock factories (hoisting)
    callback({ uid: 'user-123', displayName: 'Test User', email: 'test@example.com', photoURL: null });
    return () => { };
  }),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

// ─── Test Utilities ──────────────────────────────────────────────────────────
const mockFetchDefaults = () => {
  global.fetch.mockImplementation((url, opts) => {
    if (url === '/api/models') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: ['gemini-2.5-flash', 'gemini-2.5-pro'] }) });
    }
    if (url === '/api/chat') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ text: '## Quantum Computing\n\nA **quantum computer** uses qubits.\n\n**Quiz:** What is a qubit?\n- A) A classical bit\n- B) A quantum bit\n- C) A byte' }) });
    }
    if (url === '/api/recommendations') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ recommendations: ['Kubernetes', 'GraphQL', 'WebAssembly'] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
};

// ─── Test Suites ─────────────────────────────────────────────────────────────
describe('Universal Learning AI', () => {

  beforeEach(() => {
    global.fetch.mockReset();
    mockFetchDefaults();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Authentication ───────────────────────────────────────────────────
  describe('Authentication', () => {
    it('renders the login screen when user is NOT authenticated', async () => {
      const { getAuth, onAuthStateChanged } = await import('firebase/auth');
      onAuthStateChanged.mockImplementationOnce((auth, callback) => {
        callback(null); // No user
        return () => { };
      });

      render(<App />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
      });
    });

    it('renders the onboarding screen when user IS authenticated', async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText(/Universal Learning AI/i)).toBeInTheDocument();
      });
    });

    it('shows the user name on the onboarding screen after login', async () => {
      render(<App />);
      await waitFor(() => {
        // Checks for the greeting using the user's first name
        expect(screen.getByRole('heading', { name: /Ready to learn, Test/i })).toBeInTheDocument();
      });
    });

    it('displays the logout button in the sidebar when authenticated', async () => {
      render(<App />);
      await waitFor(() => {
        // Button text is "Log Out" (two words)
        expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
      });
    });
  });

  // ── 2. Onboarding ───────────────────────────────────────────────────────
  describe('Onboarding & Experience Selection', () => {
    it('renders all three experience level buttons', async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /beginner/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /intermediate/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /expert/i })).toBeInTheDocument();
      });
    });

    it('loads the chat view after clicking Beginner', async () => {
      render(<App />);
      await waitFor(() => screen.getByRole('button', { name: /beginner/i }));

      fireEvent.click(screen.getByRole('button', { name: /beginner/i }));

      await waitFor(() => {
        // The text area for sending messages should now be visible
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('loads the chat view after clicking Expert', async () => {
      render(<App />);
      await waitFor(() => screen.getByRole('button', { name: /expert/i }));
      fireEvent.click(screen.getByRole('button', { name: /expert/i }));
      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('calls the /api/models endpoint when an experience level is selected', async () => {
      render(<App />);
      await waitFor(() => screen.getByRole('button', { name: /beginner/i }));
      fireEvent.click(screen.getByRole('button', { name: /beginner/i }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/models');
      });
    });
  });

  // ── 3. AI Recommendations ───────────────────────────────────────────────
  describe('AI-Powered Recommendations', () => {
    it('displays the "Suggested for you" section on the home screen', async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText(/Suggested for you/i)).toBeInTheDocument();
      });
    });

    it('calls /api/recommendations on page load', async () => {
      render(<App />);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/recommendations', expect.objectContaining({ method: 'POST' }));
      });
    });

    it('renders recommendation topic cards returned by the API', async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText('Kubernetes')).toBeInTheDocument();
        expect(screen.getByText('GraphQL')).toBeInTheDocument();
        expect(screen.getByText('WebAssembly')).toBeInTheDocument();
      });
    });

    it('starts a chat when a recommendation card is clicked', async () => {
      render(<App />);
      await waitFor(() => screen.getByText('Kubernetes'));
      fireEvent.click(screen.getByText('Kubernetes'));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/chat', expect.anything());
      }, { timeout: 5000 });
    });
  });

  // ── 4. Chat Interface ────────────────────────────────────────────────────
  describe('Chat Interface', () => {
    const setupChat = async () => {
      render(<App />);
      await waitFor(() => screen.getByRole('button', { name: /beginner/i }));
      fireEvent.click(screen.getByRole('button', { name: /beginner/i }));
      await waitFor(() => screen.getByRole('textbox'), { timeout: 5000 });
    };

    it('shows the send button and text input in the chat view', async () => {
      await setupChat();
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    });

    it('disables the send button when the input is empty', async () => {
      await setupChat();
      const sendBtn = screen.getByRole('button', { name: /send/i });
      expect(sendBtn).toBeDisabled();
    });

    it('enables the send button when text is typed', async () => {
      await setupChat();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'What is React?' } });
      expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled();
    });

    it('calls /api/chat when a message is submitted', async () => {
      await setupChat();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Explain machine learning' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({ method: 'POST' }));
      });
    });

    it('displays the user message in the chat after sending', async () => {
      await setupChat();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Explain neural networks' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => {
        expect(screen.getByText('Explain neural networks')).toBeInTheDocument();
      });
    });

    it('renders the AI response markdown in the chat', async () => {
      await setupChat();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'What is quantum computing?' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => {
        expect(screen.getByText(/Quantum Computing/i)).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('clears the input field after sending a message', async () => {
      await setupChat();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Test message' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => {
        expect(input.value).toBe('');
      });
    });
  });

  // ── 5. Backend Error Handling ────────────────────────────────────────────
  describe('Error Handling', () => {
    it('handles /api/recommendations failure gracefully without crashing', async () => {
      global.fetch.mockImplementation((url) => {
        if (url === '/api/recommendations') return Promise.reject(new Error('Network error'));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: ['gemini-2.5-flash'] }) });
      });

      // Should render without throwing
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText(/Universal Learning AI/i)).toBeInTheDocument();
      });
    });

    it('shows error message in chat when /api/chat returns an error', async () => {
      global.fetch.mockImplementation((url) => {
        if (url === '/api/models') return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: ['gemini-2.5-flash'] }) });
        if (url === '/api/chat') return Promise.resolve({ ok: true, json: () => Promise.resolve({ error: 'API quota exceeded' }) });
        if (url === '/api/recommendations') return Promise.resolve({ ok: true, json: () => Promise.resolve({ recommendations: [] }) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      render(<App />);
      await waitFor(() => screen.getByRole('button', { name: /beginner/i }));
      fireEvent.click(screen.getByRole('button', { name: /beginner/i }));
      await waitFor(() => screen.getByRole('textbox'), { timeout: 5000 });

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Test error scenario' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await waitFor(() => {
        expect(screen.getByText(/Failed to process request/i)).toBeInTheDocument();
      }, { timeout: 10000 });
    }, 15000);
  });

  // ── 6. Navigation & Sidebar ──────────────────────────────────────────────
  describe('Sidebar Navigation', () => {
    it('renders the sidebar with "New Concept" button', async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /new concept/i })).toBeInTheDocument();
      });
    });

    it('renders "Learning History" label in the sidebar', async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText(/Learning History/i)).toBeInTheDocument();
      });
    });
  });

  // ── 7. Accessibility ─────────────────────────────────────────────────────
  describe('Accessibility', () => {
    it('the login button has an accessible name', async () => {
      const { onAuthStateChanged } = await import('firebase/auth');
      onAuthStateChanged.mockImplementationOnce((auth, callback) => {
        callback(null);
        return () => { };
      });
      render(<App />);
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /sign in with google/i });
        expect(btn).toBeInTheDocument();
      });
    });

    it('the chat text input has an accessible label', async () => {
      render(<App />);
      await waitFor(() => screen.getByRole('button', { name: /beginner/i }));
      fireEvent.click(screen.getByRole('button', { name: /beginner/i }));
      await waitFor(() => {
        const input = screen.getByRole('textbox');
        expect(input).toHaveAttribute('aria-label');
      }, { timeout: 5000 });
    });

    it('experience level buttons are keyboard-focusable', async () => {
      render(<App />);
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /beginner/i });
        expect(btn).not.toHaveAttribute('tabindex', '-1');
      });
    });
  });

});
