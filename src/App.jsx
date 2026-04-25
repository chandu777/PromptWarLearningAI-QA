import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, query, where, getDocs, orderBy, serverTimestamp, doc, setDoc } from "firebase/firestore";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";

// Replace these with your actual Firebase config from Google Cloud Console
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "dummy_key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "dummy.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "dummy-project",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

function App() {
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [step, setStep] = useState('login'); // login -> onboarding -> chat
  const [experience, setExperience] = useState('');
  
  const [chatHistory, setChatHistory] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  
  const [sessions, setSessions] = useState([]); // List of past questions/sessions
  const [currentSessionId, setCurrentSessionId] = useState(null);
  
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(false);

  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthChecking(false);
      if (currentUser) {
        loadUserSessions(currentUser.uid);
        setStep('onboarding');
      } else {
        setStep('login');
      }
    });
    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
      alert("Login failed! Did you remember to add VITE_FIREBASE_API_KEY to your .env?");
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setChatHistory([]);
    setSessions([]);
    setCurrentSessionId(null);
  };

  const loadUserSessions = async (userId) => {
    try {
      // Removed orderBy to avoid requiring a Firebase Composite Index which takes time to build
      const q = query(collection(db, "chats"), where("userId", "==", userId));
      const querySnapshot = await getDocs(q);
      const loadedSessions = [];
      querySnapshot.forEach((doc) => {
        loadedSessions.push({ id: doc.id, ...doc.data() });
      });
      
      // Sort the sessions client-side by newest first
      loadedSessions.sort((a, b) => {
        const timeA = a.createdAt?.toMillis() || 0;
        const timeB = b.createdAt?.toMillis() || 0;
        return timeB - timeA;
      });
      
      setSessions(loadedSessions);
      // Fetch personalized AI recommendations based on loaded history
      loadRecommendations(loadedSessions);
    } catch (e) {
      console.error("Could not load history from Firebase:", e.message);
    }
  };

  const loadRecommendations = async (pastSessions) => {
    setLoadingRecs(true);
    try {
      const pastTopics = pastSessions.map(s => s.title);
      const response = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pastTopics })
      });
      const data = await response.json();
      if (data.recommendations) {
        setRecommendations(data.recommendations);
      }
    } catch (e) {
      console.error("Failed to load recommendations", e);
    } finally {
      setLoadingRecs(false);
    }
  };

  const startNewChat = () => {
    setChatHistory([]);
    setCurrentSessionId(null);
    setStep('onboarding');
  };

  const loadChatSession = (session) => {
    setCurrentSessionId(session.id);
    setChatHistory(session.messages || []);
    setExperience(session.experienceLevel || 'Beginner');
    setStep('chat');
  };

  const savePreferenceToFirebase = async (level) => {
    console.log("[DEBUG] Starting savePreferenceToFirebase for level:", level);
    if (!user) {
        console.log("[DEBUG] No user logged in, skipping Firebase save.");
        return;
    }
    try {
      console.log("[DEBUG] Attempting to setDoc in Firestore...");
      await setDoc(doc(db, "user_preferences", user.uid), {
        experienceLevel: level,
        updatedAt: serverTimestamp()
      }, { merge: true });
      console.log("[DEBUG] Successfully saved preference to Firestore.");
    } catch (e) {
      console.error("[DEBUG] Firebase Error saving preference: ", e.message);
    }
  };

  const initializeAI = async (expLevel) => {
    console.log("[DEBUG] Starting initializeAI with level:", expLevel);
    setIsLoading(true);
    try {
      console.log("[DEBUG] Fetching available models from /api/models...");
      const response = await fetch('/api/models');
      console.log("[DEBUG] Fetch response status:", response.status);
      
      const data = await response.json();
      console.log("[DEBUG] Fetch response data:", data);
      
      if (data.error) throw new Error(data.error);
      
      const models = data.models;
      console.log("[DEBUG] Available models:", models);
      setAvailableModels(models);
      
      let defaultModel = models[0];
      if (models.includes('gemini-2.5-flash')) defaultModel = 'gemini-2.5-flash';
      else if (models.includes('gemini-2.0-flash')) defaultModel = 'gemini-2.0-flash';
      else if (models.includes('gemini-1.5-flash')) defaultModel = 'gemini-1.5-flash';
      else if (models.includes('gemini-pro')) defaultModel = 'gemini-pro';
      
      setSelectedModel(defaultModel);
      
      const initialHistory = [
        { 
          role: 'assistant', 
          content: `Hi ${user?.displayName?.split(' ')[0] || ''}! I'm your AI Learning Assistant. You selected **${expLevel}** level.\n\nI securely connected to the \`${defaultModel}\` model.\n\nWhat concept or topic would you like to learn today?` 
        }
      ];
      setChatHistory(initialHistory);
      setStep('chat');
      console.log("[DEBUG] initializeAI completed successfully. Transitioning to chat.");
    } catch (error) {
       console.error("[DEBUG] initializeAI Catch Error:", error);
       alert("Failed to connect to backend: " + error.message);
    } finally {
       setIsLoading(false);
    }
  };

  const handleSuggestedClick = async (topic) => {
    const defaultExp = experience || 'Beginner';
    setExperience(defaultExp);
    savePreferenceToFirebase(defaultExp);
    
    setIsLoading(true);
    setStep('chat');
    
    try {
      // 1. Get Models
      const response = await fetch('/api/models');
      const data = await response.json();
      const models = data.models;
      console.log("[DEBUG] Available models:", models);
      setAvailableModels(models);
      
      let defaultModel = models.includes('gemini-2.5-flash') ? 'gemini-2.5-flash' : models[0];
      setSelectedModel(defaultModel);
      
      // 2. Setup initial history simulating the user asking about the topic
      const initialHistory = [
        { 
          role: 'assistant', 
          content: `Hi ${user?.displayName?.split(' ')[0] || ''}! I'm your AI Learning Assistant. You selected **${defaultExp}** level.\n\nI securely connected to the \`${defaultModel}\` model.\n\nWhat concept or topic would you like to learn today?` 
        },
        { role: 'user', content: topic }
      ];
      setChatHistory(initialHistory);

      // 3. Generate AI response for the topic
      const systemPrompt = `You are an expert AI teacher. The user's experience level in the current topic is: ${defaultExp}. 
      If the user is asking about a new concept, explain it clearly and appropriately for a ${defaultExp}. 
      Include: 
      1. A clear explanation.
      2. A concrete example.
      3. A 1-question multiple-choice quiz to check their understanding.
      If the user is answering a previous quiz, evaluate their answer, explain why it's right or wrong, and ask what they want to learn next. Format using Markdown. DO NOT output HTML.`;

      const promptContext = initialHistory.map(msg => `${msg.role === 'user' ? 'Student' : 'Teacher'}: ${msg.content}`).join('\n\n');
      const finalPrompt = `${systemPrompt}\n\nConversation History:\n${promptContext}\n\nStudent: ${topic}\n\nTeacher:`;

      const chatResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedModel: defaultModel, finalPrompt })
      });
      
      const chatData = await chatResponse.json();
      if (chatData.error) throw new Error(chatData.error);

      const updatedHistory = [...initialHistory, { role: 'assistant', content: chatData.text }];
      setChatHistory(updatedHistory);

      // 4. Save to Firebase
      if (user) {
         addDoc(collection(db, "chats"), {
            userId: user.uid,
            title: topic.substring(0, 30),
            experienceLevel: defaultExp,
            messages: updatedHistory,
            createdAt: serverTimestamp()
          }).then(newDoc => {
            setCurrentSessionId(newDoc.id);
            setSessions(prev => [{ id: newDoc.id, title: topic.substring(0, 30), messages: updatedHistory }, ...prev]);
          }).catch(e => console.error("Firebase save failed", e));
      }
    } catch (e) {
       console.error(e);
       alert("Error processing AI suggestion.");
    } finally {
       setIsLoading(false);
    }
  };

  const handleExperienceSelect = (level) => {
    console.log("[DEBUG] Button clicked! Selected level:", level);
    setExperience(level);
    console.log("[DEBUG] Calling savePreferenceToFirebase in background.");
    savePreferenceToFirebase(level);
    console.log("[DEBUG] Calling initializeAI.");
    initializeAI(level);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    const userMsg = inputMessage;
    setInputMessage('');
    
    const newHistory = [...chatHistory, { role: 'user', content: userMsg }];
    setChatHistory(newHistory);
    setIsLoading(true);

    try {
      const systemPrompt = `You are an expert AI teacher. The user's experience level in the current topic is: ${experience}. 
      If the user is asking about a new concept, explain it clearly and appropriately for a ${experience}. 
      Include: 
      1. A clear explanation.
      2. A concrete example.
      3. A 1-question multiple-choice quiz to check their understanding.
      If the user is answering a previous quiz, evaluate their answer, explain why it's right or wrong, and ask what they want to learn next. Format using Markdown. DO NOT output HTML.`;

      const promptContext = newHistory.map(msg => `${msg.role === 'user' ? 'Student' : 'Teacher'}: ${msg.content}`).join('\n\n');
      const finalPrompt = `${systemPrompt}\n\nConversation History:\n${promptContext}\n\nStudent: ${userMsg}\n\nTeacher:`;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedModel, finalPrompt })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      const updatedHistory = [...newHistory, { role: 'assistant', content: data.text }];
      setChatHistory(updatedHistory);

      // Save to Firebase History (Run in background to prevent UI freeze!)
      if (user) {
        if (!currentSessionId) {
          addDoc(collection(db, "chats"), {
            userId: user.uid,
            title: userMsg.substring(0, 30) + '...',
            experienceLevel: experience,
            messages: updatedHistory,
            createdAt: serverTimestamp()
          }).then(newDoc => {
            setCurrentSessionId(newDoc.id);
            setSessions(prev => [{ id: newDoc.id, title: userMsg.substring(0, 30) + '...', messages: updatedHistory }, ...prev]);
          }).catch(e => console.error("Firebase save failed", e));
        } else {
          setDoc(doc(db, "chats", currentSessionId), {
            messages: updatedHistory,
            updatedAt: serverTimestamp()
          }, { merge: true }).then(() => {
            setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: updatedHistory } : s));
          }).catch(e => console.error("Firebase update failed", e));
        }
      }

    } catch (error) {
      setChatHistory([...newHistory, { role: 'assistant', content: `**Error:** Failed to process request. (${error.message})` }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (authChecking) {
    return <div className="app-container"><div className="dot-flashing"></div></div>;
  }

  return (
    <div className="layout-wrapper">
      {/* SIDEBAR FOR HISTORY */}
      {user && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <h3>Learning History</h3>
            <button className="new-chat-btn" onClick={startNewChat}>+ New Concept</button>
          </div>
          <ul className="history-list">
            {sessions.map(session => (
              <li key={session.id} 
                  className={currentSessionId === session.id ? 'active' : ''} 
                  onClick={() => loadChatSession(session)}>
                {session.title || "Untitled Session"}
              </li>
            ))}
            {sessions.length === 0 && <p className="no-history">No past concepts yet.</p>}
          </ul>
          <div className="sidebar-footer">
            <div className="user-info">
               {user.photoURL && <img src={user.photoURL} alt="Profile" className="avatar" />}
               <span>{user.displayName?.split(' ')[0] || user.email}</span>
            </div>
            <button className="logout-btn" onClick={handleLogout}>Log Out</button>
          </div>
        </aside>
      )}

      {/* MAIN CONTENT AREA */}
      <main className="main-content" role="main">
        {step === 'login' && (
          <div className="app-container">
            <header><h1>Universal Learning AI</h1></header>
            <div className="card login-card">
              <h2>Welcome Back</h2>
              <p>Sign in to save your progress and personalized learning history.</p>
              <button className="google-btn" onClick={loginWithGoogle}>
                Sign in with Google
              </button>
              <p style={{marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)'}}>
                *Requires Firebase config to be added to `.env`
              </p>
            </div>
          </div>
        )}

        {step === 'onboarding' && user && (
          <div className="app-container" style={{maxWidth: '900px'}}>
            <header><h1 tabIndex="0">Universal Learning AI</h1></header>

            <section className="card" style={{ marginBottom: '1.5rem' }}>
               <h2>Suggested for you</h2>
               <p>Powered by Google Gemini API</p>
               {loadingRecs ? (
                 <div className="dot-flashing" style={{ margin: '2rem auto' }}></div>
               ) : (
                 <div className="recent-topics">
                   {recommendations.map((topic, idx) => (
                     <div key={idx} className="topic-card" style={{borderColor: 'var(--primary)'}} onClick={() => handleSuggestedClick(topic)} role="button" tabIndex="0">
                        <h4 style={{color: '#c4b5fd'}}>{topic}</h4>
                        <span className="badge">+ Explore</span>
                     </div>
                   ))}
                 </div>
               )}
            </section>

            <section className="card">
              <h2>Start a new concept manually</h2>
              <p>Select your experience level to begin a new personalized session:</p>
              
              <div className="options-row">
                <button onClick={() => handleExperienceSelect('Beginner')} disabled={isLoading}>
                  {isLoading ? 'Connecting...' : 'Beginner'}
                </button>
                <button onClick={() => handleExperienceSelect('Intermediate')} disabled={isLoading}>
                  {isLoading ? 'Connecting...' : 'Intermediate'}
                </button>
                <button onClick={() => handleExperienceSelect('Expert')} disabled={isLoading}>
                  {isLoading ? 'Connecting...' : 'Expert'}
                </button>
              </div>
            </section>
          </div>
        )}

        {step === 'chat' && user && (
          <section className="chat-container">
            <header className="chat-header">
              <span className="badge">Level: {experience}</span>
              <select 
                value={selectedModel} 
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{ background: 'var(--card-bg)', color: 'white', border: '1px solid #475569', borderRadius: '8px', padding: '0.25rem 0.5rem', marginLeft: 'auto' }}
              >
                {availableModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </header>
            
            <div className="chat-messages">
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`message ${msg.role}`}>
                  <div className="message-content">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="message assistant">
                  <div className="message-content loading">
                    <div className="dot-flashing"></div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={sendMessage} className="chat-input-area">
              <input 
                type="text" 
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Ask me to explain any concept..."
                disabled={isLoading}
                required
              />
              <button type="submit" disabled={isLoading || !inputMessage.trim()}>Send</button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
