/**
 * User Menu Component
 * 
 * Shows user status, AISIS link status, and logout option.
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AisisLinkModal } from './AisisLinkModal';
import './UserMenu.css';

export function UserMenu() {
  const { user, logout, checkAisisStatus, unlinkAisis } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showAisisModal, setShowAisisModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (user) {
      checkAisisStatus();
    }
  }, []);

  if (!user) return null;

  const handleUnlink = async () => {
    if (!confirm('Are you sure you want to unlink your AISIS account?')) return;
    
    setIsLoading(true);
    try {
      await unlinkAisis();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="user-menu">
        <button 
          className="user-menu-trigger"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className="user-avatar">
            {user.email.charAt(0).toUpperCase()}
          </span>
          <span className="user-email">{user.email}</span>
          <span className="dropdown-arrow">▼</span>
        </button>

        {isOpen && (
          <div className="user-menu-dropdown" onClick={() => setIsOpen(false)}>
            <div className="user-menu-header">
              <span className="user-name">{user.email}</span>
              <span className={`aisis-status ${user.aisisLinked ? 'linked' : ''}`}>
                {user.aisisLinked ? '🔗 AISIS Linked' : '⚠️ AISIS Not Linked'}
              </span>
            </div>
            
            <div className="user-menu-options">
              {user.aisisLinked ? (
                <button onClick={handleUnlink} disabled={isLoading}>
                  {isLoading ? 'Unlinking...' : 'Unlink AISIS'}
                </button>
              ) : (
                <button 
                  onClick={() => {
                    setShowAisisModal(true);
                    setIsOpen(false);
                  }}
                  className="link-aisis-btn"
                >
                  Link AISIS Account
                </button>
              )}
              
              <button onClick={logout} className="logout-btn">
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>

      <AisisLinkModal 
        isOpen={showAisisModal} 
        onClose={() => setShowAisisModal(false)} 
      />
    </>
  );
}
