/**
 * ContextBar - Circular progress bar showing AI context window usage
 * Displays real token usage from Gemini API
 */

import { useState } from 'react';
import './ContextBar.css';

interface TokenUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  maxTokens: number;
  usagePercent: number;
}

interface ContextBarProps {
  tokenUsage?: TokenUsage;
}

export function ContextBar({ tokenUsage }: ContextBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Default values if no token usage yet
  const usage = tokenUsage || {
    promptTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    maxTokens: 1048576,
    usagePercent: 0,
  };
  
  // Calculate stroke offset for circular progress
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (usage.usagePercent / 100) * circumference;
  
  // Color based on usage level
  const getColor = () => {
    if (usage.usagePercent < 50) return '#10b981'; // green
    if (usage.usagePercent < 80) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  };
  
  // Format large numbers
  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div 
      className={`context-bar ${isExpanded ? 'expanded' : ''}`}
      onClick={() => setIsExpanded(!isExpanded)}
      title="AI Context Window Usage"
    >
      <svg className="progress-ring" viewBox="0 0 44 44">
        {/* Background circle */}
        <circle
          className="progress-ring-bg"
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          strokeWidth="4"
        />
        {/* Progress circle */}
        <circle
          className="progress-ring-fill"
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ stroke: getColor() }}
        />
      </svg>
      <span className="context-percent">{usage.usagePercent.toFixed(1)}%</span>
      
      {isExpanded && (
        <div className="context-details">
          <div className="context-detail-row">
            <span>Prompt:</span>
            <span>{formatTokens(usage.promptTokens)}</span>
          </div>
          <div className="context-detail-row">
            <span>Response:</span>
            <span>{formatTokens(usage.responseTokens)}</span>
          </div>
          <div className="context-detail-row">
            <span>Total:</span>
            <span>{formatTokens(usage.totalTokens)} / {formatTokens(usage.maxTokens)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default ContextBar;
