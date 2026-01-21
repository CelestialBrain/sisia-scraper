/**
 * Debug Panel Component
 * 
 * Collapsible sidebar showing AI internals: tool calls, tokens, memory
 * Connects to WebSocket for live console streaming
 */

import { useState, useEffect, useRef } from 'react';
import './DebugPanel.css';

export interface DebugInfo {
  toolsCalled: {
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    durationMs: number;
  }[];
  tokensUsed: {
    prompt: number;
    response: number;
    total: number;
  };
  historyLength: number;
  model: string;
  timestamp: string;
}

interface ConsoleLog {
  level: 'info' | 'function' | 'result' | 'error';
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

interface DebugPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  debugHistory: DebugInfo[];
}

export function DebugPanel({ isOpen, onToggle, debugHistory }: DebugPanelProps) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [showRaw, setShowRaw] = useState<number | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Connect to WebSocket for live logs
  useEffect(() => {
    if (!isOpen) return;
    
    const ws = new WebSocket('ws://localhost:6102/ws');
    wsRef.current = ws;
    
    ws.onopen = () => {
      setWsConnected(true);
      setConsoleLogs(prev => [...prev, {
        level: 'info',
        message: 'Connected to debug stream',
        timestamp: new Date().toISOString()
      }]);
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'console_log' && msg.payload) {
          setConsoleLogs(prev => [...prev.slice(-50), msg.payload as ConsoleLog]);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };
    
    ws.onclose = () => {
      setWsConnected(false);
    };
    
    ws.onerror = () => {
      setWsConnected(false);
    };
    
    return () => {
      ws.close();
    };
  }, [isOpen]);

  // Auto-scroll console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLogs]);

  const toggleExpand = (index: number) => {
    const newSet = new Set(expandedItems);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setExpandedItems(newSet);
  };

  const latestDebug = debugHistory[debugHistory.length - 1];

  const getLogColor = (level: string) => {
    switch (level) {
      case 'function': return '#4ade80';
      case 'result': return '#4a9eff';
      case 'error': return '#ef4444';
      default: return '#888';
    }
  };

  // Export all logs to clipboard
  const exportLogs = async () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      sessionInfo: {
        totalTurns: debugHistory.length,
        wsConnected,
      },
      consoleLogs: consoleLogs,
      debugHistory: debugHistory,
    };
    
    const text = JSON.stringify(exportData, null, 2);
    await navigator.clipboard.writeText(text);
    alert('Debug logs copied to clipboard! Paste them to share for debugging.');
  };

  return (
    <>
      {/* Toggle Button */}
      <button 
        className={`debug-toggle ${isOpen ? 'active' : ''}`} 
        onClick={onToggle}
        title="Toggle Debug Panel"
      >
        🐛
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="debug-panel">
          <div className="debug-header">
            <h3>Debug Console</h3>
            <span className={`ws-status ${wsConnected ? 'connected' : ''}`}>
              {wsConnected ? '● Live' : '○ Offline'}
            </span>
            <button className="export-btn" onClick={exportLogs} title="Export Logs">
              📋 Export
            </button>
            <button className="debug-close" onClick={onToggle}>×</button>
          </div>

          <div className="debug-content">
            {/* Live Console */}
            <div className="debug-section">
              <h4>Live Console</h4>
              <div className="live-console">
                {consoleLogs.length === 0 ? (
                  <p className="no-logs">Waiting for activity...</p>
                ) : (
                  consoleLogs.map((log, idx) => (
                    <div key={idx} className="console-line">
                      <span className="log-time">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span 
                        className="log-message"
                        style={{ color: getLogColor(log.level) }}
                      >
                        {log.level === 'function' && '📞 '}
                        {log.level === 'result' && '✅ '}
                        {log.level === 'error' && '❌ '}
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
                <div ref={consoleEndRef} />
              </div>
            </div>

            {/* Latest Response Stats */}
            {latestDebug && (
              <div className="debug-section">
                <h4>Latest Response</h4>
                <div className="debug-stats">
                  <div className="stat">
                    <span className="label">Model</span>
                    <span className="value">{latestDebug.model}</span>
                  </div>
                  <div className="stat">
                    <span className="label">Tokens</span>
                    <span className="value">
                      {latestDebug.tokensUsed.prompt} → {latestDebug.tokensUsed.response} 
                      <span className="total"> ({latestDebug.tokensUsed.total} total)</span>
                    </span>
                  </div>
                  <div className="stat">
                    <span className="label">History</span>
                    <span className="value">{latestDebug.historyLength} messages</span>
                  </div>
                </div>
              </div>
            )}

            {/* Tool Calls Detail */}
            {latestDebug && latestDebug.toolsCalled.length > 0 && (
              <div className="debug-section">
                <h4>Tool Calls ({latestDebug.toolsCalled.length})</h4>
                <div className="tool-list">
                  {latestDebug.toolsCalled.map((tool, idx) => (
                    <div key={idx} className="tool-item">
                      <div 
                        className="tool-header"
                        onClick={() => toggleExpand(idx)}
                      >
                        <span className="tool-name">{tool.name}</span>
                        <span className="tool-duration">{tool.durationMs}ms</span>
                        <span className="expand-icon">{expandedItems.has(idx) ? '▼' : '▶'}</span>
                      </div>
                      
                      {expandedItems.has(idx) && (
                        <div className="tool-details">
                          <div className="detail-section">
                            <span className="detail-label">Args:</span>
                            <pre>{JSON.stringify(tool.args, null, 2)}</pre>
                          </div>
                          <div className="detail-section">
                            <span className="detail-label">Result:</span>
                            <pre>{JSON.stringify(tool.result, null, 2).slice(0, 500)}
                              {JSON.stringify(tool.result).length > 500 && '...'}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Debug History */}
            {debugHistory.length > 1 && (
              <div className="debug-section">
                <h4>History ({debugHistory.length} turns)</h4>
                <div className="history-list">
                  {debugHistory.slice(-5).reverse().map((debug, idx) => (
                    <div key={idx} className="history-item">
                      <span className="history-time">
                        {new Date(debug.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="history-tools">
                        {debug.toolsCalled.length} tool{debug.toolsCalled.length !== 1 ? 's' : ''}
                      </span>
                      <button 
                        className="raw-btn"
                        onClick={() => setShowRaw(showRaw === idx ? null : idx)}
                      >
                        {showRaw === idx ? 'Hide' : 'Raw'}
                      </button>
                      {showRaw === idx && (
                        <pre className="raw-json">{JSON.stringify(debug, null, 2)}</pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
