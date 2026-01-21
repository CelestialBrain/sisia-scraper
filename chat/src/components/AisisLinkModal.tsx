/**
 * AISIS Link Modal
 * 
 * For linking AISIS account to enable personal features.
 * Displays security notice about encrypted storage.
 */

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './AuthModal.css';

interface AisisLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AisisLinkModal({ isOpen, onClose }: AisisLinkModalProps) {
  const { linkAisis } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    
    try {
      await linkAisis(username, password);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to link AISIS');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal aisis-link-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-modal-header aisis-header">
          <div className="auth-modal-logo">🔗</div>
          <h2>Link AISIS Account</h2>
          <p>Access your personal schedule, grades, and IPS</p>
        </div>
        
        {/* Security notice */}
        <div className="aisis-security-notice">
          <span className="security-icon">🔒</span>
          <div>
            <strong>Your credentials are encrypted</strong>
            <p>We use AES-256-GCM encryption. Your password is never stored in plain text.</p>
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}
          
          <div className="auth-field">
            <label htmlFor="aisis-username">AISIS Username</label>
            <input
              id="aisis-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Your AISIS ID"
              required
            />
          </div>
          
          <div className="auth-field">
            <label htmlFor="aisis-password">AISIS Password</label>
            <input
              id="aisis-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          
          <button type="submit" className="auth-submit aisis-submit" disabled={isLoading}>
            {isLoading ? 'Linking...' : 'Link Account'}
          </button>
        </form>
        
        <div className="auth-footer aisis-footer">
          <small>We only access: Schedule, IPS, Grades, Hold Orders</small>
          <small className="blocked-notice">❌ Personal info (J_STUD_INFO) is never accessed</small>
        </div>
        
        <button className="auth-close" onClick={onClose}>×</button>
      </div>
    </div>
  );
}
