import { useState, useRef, useEffect } from 'react';
import './App.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: messages,
        }),
      });

      const data = await response.json();
      
      if (data.response) {
        setMessages([...newMessages, { role: 'assistant', content: data.response }]);
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
    // Simple markdown table detection and formatting
    const lines = content.split('\n');
    const formatted: JSX.Element[] = [];
    let tableRows: string[][] = [];
    let inTable = false;

    lines.forEach((line, idx) => {
      // Detect table rows (lines with |)
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        if (!inTable) inTable = true;
        const cells = line.split('|').filter(c => c.trim() !== '');
        if (!line.includes('---')) {
          tableRows.push(cells.map(c => c.trim()));
        }
      } else {
        // End of table
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
        
        // Handle bold text
        const boldParsed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        if (line.trim()) {
          formatted.push(
            <p key={idx} dangerouslySetInnerHTML={{ __html: boldParsed }} />
          );
        }
      }
    });

    // Handle trailing table
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

  const exampleQueries = [
    "What time is MATH 30.13?",
    "What does Dr. Yap teach on Friday?",
    "Show me all DISCS instructors",
    "List all rooms",
    "Find MWF morning classes",
  ];

  return (
    <div className="app">
      <div className="chat-container">
        {/* Header */}
        <header className="chat-header">
          <h1>SISIA Assistant</h1>
          <p>Your Ateneo schedule helper • Powered by Gemini</p>
        </header>

        {/* Messages */}
        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome">
              <div className="welcome-icon">📚</div>
              <h2>How can I help you today?</h2>
              <p>Ask me about courses, schedules, instructors, or rooms.</p>
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
            placeholder="Ask about courses, schedules, instructors..."
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
