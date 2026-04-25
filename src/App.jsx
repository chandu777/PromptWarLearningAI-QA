import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import ReactMarkdown from 'react-markdown';

function App() {
  const [step, setStep] = useState('onboarding'); // onboarding -> setup -> chat
  const [experience, setExperience] = useState('');
  
  // Read API Key from .env file (if it exists)
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '');
  
  const [chatHistory, setChatHistory] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [genAI, setGenAI] = useState(null);
  
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // Main logic to initialize AI connection
  const initializeAI = async (keyToUse, expLevel) => {
    setIsLoading(true);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyToUse}`);
      const data = await response.json();
      
      if (data.error) throw new Error(data.error.message);
      
      const models = data.models
        .filter(m => m.supportedGenerationMethods.includes("generateContent"))
        .map(m => m.name.replace('models/', ''));
        
      setAvailableModels(models);
      
      let defaultModel = models[0];
      if (models.includes('gemini-2.5-flash')) defaultModel = 'gemini-2.5-flash';
      else if (models.includes('gemini-2.0-flash')) defaultModel = 'gemini-2.0-flash';
      else if (models.includes('gemini-1.5-flash')) defaultModel = 'gemini-1.5-flash';
      else if (models.includes('gemini-pro')) defaultModel = 'gemini-pro';
      
      setSelectedModel(defaultModel);

      const ai = new GoogleGenerativeAI(keyToUse);
      setGenAI(ai);
      
      setChatHistory([
        { 
          role: 'assistant', 
          content: `Hi! I'm your AI Learning Assistant. You selected **${expLevel}** level.\n\nI connected to the \`${defaultModel}\` model.\n\nWhat concept or topic would you like to learn today?` 
        }
      ]);
      
      setStep('chat');
    } catch (error) {
       console.error("API Key Error:", error);
       alert("Error with API Key: " + error.message);
       setStep('setup'); // Send them to the manual input screen if the .env key is broken
    } finally {
       setIsLoading(false);
    }
  };

  const handleExperienceSelect = (level) => {
    setExperience(level);
    if (apiKey.trim() !== '') {
      // If we loaded the API key from the .env file, jump straight into the chat!
      initializeAI(apiKey, level);
    } else {
      // Otherwise, ask the user to type it in.
      setStep('setup');
    }
  };

  const handleSetupStart = (e) => {
    e.preventDefault();
    if (apiKey.trim() === '') return;
    initializeAI(apiKey, experience);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !genAI) return;

    const userMsg = inputMessage;
    setInputMessage('');
    
    const newHistory = [...chatHistory, { role: 'user', content: userMsg }];
    setChatHistory(newHistory);
    setIsLoading(true);

    try {
      const model = genAI.getGenerativeModel({ model: selectedModel }); 
      
      const systemPrompt = `You are an expert AI teacher. The user's experience level in the current topic is: ${experience}. 
      If the user is asking about a new concept, explain it clearly and appropriately for a ${experience}. 
      Include: 
      1. A clear explanation.
      2. A concrete example.
      3. A 1-question multiple-choice quiz to check their understanding.
      If the user is answering a previous quiz, evaluate their answer, explain why it's right or wrong, and ask what they want to learn next. Format using Markdown. DO NOT output HTML.`;

      const promptContext = newHistory.map(msg => `${msg.role === 'user' ? 'Student' : 'Teacher'}: ${msg.content}`).join('\n\n');
      const finalPrompt = `${systemPrompt}\n\nConversation History:\n${promptContext}\n\nStudent: ${userMsg}\n\nTeacher:`;

      const result = await model.generateContent(finalPrompt);
      const responseText = result.response.text();

      setChatHistory([...newHistory, { role: 'assistant', content: responseText }]);
    } catch (error) {
      console.error("Error calling Gemini:", error);
      setChatHistory([...newHistory, { role: 'assistant', content: `**Error:** Failed to get response. (${error.message})` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>Universal Learning AI</h1>
      </header>

      {step === 'onboarding' && (
        <div className="card">
          <h2>Welcome! Let's personalize your path.</h2>
          <p>What is your general experience level with learning new complex concepts?</p>
          
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
        </div>
      )}

      {step === 'setup' && (
        <div className="card">
          <h2>Just one more step</h2>
          <p>To power the AI explanations, please provide a Google Gemini API Key. <br/>(You can get one for free at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{color: '#a78bfa'}}>Google AI Studio</a>)</p>
          
          <form onSubmit={handleSetupStart} className="setup-form">
            <input 
              type="password" 
              placeholder="Paste your Gemini API Key here" 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
            <button type="submit" className="primary" disabled={isLoading}>
              {isLoading ? 'Connecting...' : 'Start Learning →'}
            </button>
          </form>
        </div>
      )}

      {step === 'chat' && (
        <div className="chat-container">
          <div className="chat-header">
            <span className="badge">Level: {experience}</span>
            <select 
              value={selectedModel} 
              onChange={(e) => setSelectedModel(e.target.value)}
              style={{ background: 'var(--card-bg)', color: 'white', border: '1px solid #475569', borderRadius: '8px', padding: '0.25rem 0.5rem', marginLeft: '1rem' }}
            >
              {availableModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          
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
            />
            <button type="submit" disabled={isLoading || !inputMessage.trim()}>Send</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
