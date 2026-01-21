import { useState, useRef, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginModal } from './components/LoginModal';
import { RegisterModal } from './components/RegisterModal';
import { UserMenu } from './components/UserMenu';
import { ContextBar } from './components/ContextBar';
import { DebugPanel, type DebugInfo } from './components/DebugPanel';
import './App.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function ChatApp() {
  const { user, accessToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<{
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
    maxTokens: number;
    usagePercent: number;
  } | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugHistory, setDebugHistory] = useState<DebugInfo[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    
    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Use personal endpoint if authenticated, public otherwise
      const endpoint = user && accessToken && user.aisisLinked
        ? 'http://localhost:6102/api/chat/personal'
        : 'http://localhost:6102/api/chat';
      
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: userMessage,
          history: messages,
        }),
      });

      const data = await response.json();
      
      if (data.response) {
        setMessages([...newMessages, { role: 'assistant', content: data.response }]);
        // Update token usage from API response
        if (data.tokenUsage) {
          setTokenUsage(data.tokenUsage);
        }
        // Store debug info
        if (data.debug) {
          setDebugHistory(prev => [...prev, data.debug]);
        }
      } else if (data.error) {
        setMessages([...newMessages, { role: 'assistant', content: `Error: ${data.error}` }]);
      }
    } catch (error) {
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: 'Sorry, I couldn\'t connect to the server. Make sure the API is running.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Parse markdown-style tables and formatting
  const formatMessage = (content: string) => {
    const lines = content.split('\n');
    const formatted: JSX.Element[] = [];
    let tableRows: string[][] = [];
    let inTable = false;

    lines.forEach((line, idx) => {
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        if (!inTable) inTable = true;
        const cells = line.split('|').filter(c => c.trim() !== '');
        if (!line.includes('---')) {
          tableRows.push(cells.map(c => c.trim()));
        }
      } else {
        if (inTable && tableRows.length > 0) {
          formatted.push(
            <table key={`table-${idx}`} className="chat-table">
              <thead>
                <tr>
                  {tableRows[0].map((cell, i) => <th key={i}>{cell}</th>)}
                </tr>
              </thead>
              <tbody>
                {tableRows.slice(1).map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((cell, cellIdx) => <td key={cellIdx}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          );
          tableRows = [];
          inTable = false;
        }
        
        const boldParsed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        if (line.trim()) {
          formatted.push(
            <p key={idx} dangerouslySetInnerHTML={{ __html: boldParsed }} />
          );
        }
      }
    });

    if (tableRows.length > 0) {
      formatted.push(
        <table key="table-end" className="chat-table">
          <thead>
            <tr>
              {tableRows[0].map((cell, i) => <th key={i}>{cell}</th>)}
            </tr>
          </thead>
          <tbody>
            {tableRows.slice(1).map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => <td key={cellIdx}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    return formatted.length > 0 ? formatted : <p>{content}</p>;
  };

  const exampleQueries = user?.aisisLinked
    ? [
        "What's my schedule for today?",
        "Show my IPS progress",
        "What are my grades?",
        "Do I have any hold orders?",
      ]
    : [
        "What time is MATH 30.13?",
        "What does Dr. Yap teach on Friday?",
        "Find MWF morning classes",
        "Show BS CS curriculum",
      ];

  return (
    <div className="app">
      <div className="chat-container">
        {/* Header */}
        <header className="chat-header">
          <div className="header-left">
            <h1>SISIA</h1>
            <p>Ateneo Schedule Assistant</p>
          </div>
          <div className="header-right">
            {tokenUsage && <ContextBar tokenUsage={tokenUsage} />}
            {user ? (
              <UserMenu />
            ) : (
              <button 
                className="login-btn"
                onClick={() => setShowLogin(true)}
              >
                Sign In
              </button>
            )}
          </div>
        </header>

        {/* Personal features banner */}
        {user && !user.aisisLinked && (
          <div className="link-banner">
            <span>🔗</span>
            <span>Link your AISIS account to access personal features</span>
          </div>
        )}

        {/* Messages */}
        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome">
              <div className="welcome-icon">📚</div>
              <h2>How can I help you today?</h2>
              <p>
                {user?.aisisLinked 
                  ? "Ask about your personal schedule, grades, or IPS."
                  : "Ask me about courses, schedules, instructors, or rooms."}
              </p>
              <div className="suggestions">
                {exampleQueries.map((query, idx) => (
                  <button
                    key={idx}
                    className="suggestion"
                    onClick={() => setInput(query)}
                  >
                    {query}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className="message-content">
                {msg.role === 'assistant' ? formatMessage(msg.content) : msg.content}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="message assistant">
              <div className="message-avatar">🤖</div>
              <div className="message-content loading">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form className="chat-input" onSubmit={sendMessage}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={user?.aisisLinked 
              ? "Ask about your schedule, grades, IPS..." 
              : "Ask about courses, schedules, instructors..."}
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </form>
      </div>

      {/* Auth Modals */}
      <LoginModal 
        isOpen={showLogin} 
        onClose={() => setShowLogin(false)}
        onSwitchToRegister={() => {
          setShowLogin(false);
          setShowRegister(true);
        }}
      />
      <RegisterModal
        isOpen={showRegister}
        onClose={() => setShowRegister(false)}
        onSwitchToLogin={() => {
          setShowRegister(false);
          setShowLogin(true);
        }}
      />

      {/* Debug Panel */}
      <DebugPanel
        isOpen={debugOpen}
        onToggle={() => setDebugOpen(!debugOpen)}
        debugHistory={debugHistory}
      />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <ChatApp />
    </AuthProvider>
  );
}

export default App;
