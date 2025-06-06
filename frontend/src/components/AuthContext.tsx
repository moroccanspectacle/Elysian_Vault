import React, { createContext, useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

interface AuthContextType {
  user: any | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<{ mfaRequired: boolean }>;
  completeMfaLogin: (token: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  error: string | null;
  updateUser: (userData: Partial<{
    username: string;
    email: string;
    profileImage: string | null;
  }>) => void;
  mfaRequired: boolean;
  mfaSetupRequired: boolean;
  tempUserId: string | null;
  refreshUserData: () => Promise<void>;
  resetMfaSetupState: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [tempUserId, setTempUserId] = useState<string | null>(null);
  const [rememberMeOption, setRememberMeOption] = useState(false);
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);
  const [blockRedirects, setBlockRedirects] = useState(false);
  const navigate = useNavigate();

  const checkLoggedIn = async () => {
    // Check all possible MFA setup flags
    const mfaSetupInProgress = sessionStorage.getItem('mfa-setup-in-progress') === 'true';
    const localStorageBlock = localStorage.getItem('mfa-setup-block') === 'true';
    
    // If any flag indicates setup is in progress, don't continue
    if (mfaSetupInProgress || localStorageBlock || blockRedirects || mfaSetupRequired) {
      return;
    }
    
    const token = localStorage.getItem('auth-token');
    if (token) {
      setIsLoading(true);
      try {
        const response = await fetch('http://localhost:3000/api/user/verify', {
          headers: {
            'auth-token': token
          }
        });
        
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
          
          // Check needsMfaSetup flag from backend
          if (userData.needsMfaSetup) {
            setMfaSetupRequired(true);
            setIsLoading(false);
            return;
          }
          
          // Only redirect if not on an appropriate page and not setting up MFA
          if (!mfaSetupRequired) {
            const noRedirectPaths = ['/profile', '/settings', '/admin', '/dashboard', '/teams', '/shared-links', '/vault'];
            const currentPath = window.location.pathname;
            
            //logs
            console.log('Current path:', currentPath);
            console.log('Path check result:', noRedirectPaths.some(path => 
              currentPath.toLowerCase().includes(path.toLowerCase())
            ));
            
            if (!noRedirectPaths.some(path => currentPath.toLowerCase().includes(path.toLowerCase()))) {
              console.log('Redirecting from', currentPath);
              if (userData.role === 'admin' || userData.role === 'super_admin') {
                navigate('/admin');
              } else {
                navigate('/dashboard');
              }
            }
          }
        } else {
          // Token invalid
          localStorage.removeItem('auth-token');
          setUser(null);
        }
      } catch (error) {
        console.error("Auth verification error:", error);
      } finally {
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkLoggedIn();
  }, [navigate]);

  const login = async (email: string, password: string, rememberMe = false) => {
    setError(null);
    setRememberMeOption(rememberMe);
    try {
      const response = await fetch('http://localhost:3000/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      
      // If 2FA setup is needed, block redirects with stronger flags
      if (typeof data === 'object' && data.mfaRequired && data.setupRequired) {
       
        console.log('[AuthContext Login] MFA Setup Required. Received data:', JSON.stringify(data));
        console.log(`[AuthContext Login] data.setupToken value: ${data.setupToken}`);
        

        
        sessionStorage.setItem('temp-user-id', data.userId);

        // Store the setup token
        if (data.setupToken) {
          sessionStorage.setItem('mfa-setup-token', data.setupToken);
          console.log('[AuthContext Login] Stored mfa-setup-token in sessionStorage.'); // Log success
        } else {
          console.error('[AuthContext Login] ERROR: data.setupToken was missing or undefined! Cannot store.'); // Log failure
        }

        setTempUserId(data.userId);
        setMfaSetupRequired(true);
        setBlockRedirects(true);

        

        sessionStorage.setItem('mfa-setup-in-progress', 'true');
        localStorage.setItem('mfa-setup-block', 'true');

        return { mfaRequired: true, setupRequired: true };
      }
      
      // Regular MFA required
      if (typeof data === 'object' && data.mfaRequired) {
        setTempUserId(data.userId);
        setMfaRequired(true);
        return { mfaRequired: true };
      }

      // Clean any MFA setup flags if the response doesn't require it
      if (!(typeof data === 'object' && data.mfaRequired && data.setupRequired)) {
        sessionStorage.removeItem('mfa-setup-in-progress');
        sessionStorage.removeItem('mfa-setup-token');
        localStorage.removeItem('mfa-setup-block');
        setBlockRedirects(false);
        setMfaSetupRequired(false);
      }

      const token = typeof data === 'object' ? data.token : data;
      localStorage.setItem('auth-token', token);
      
      // Get user info with role
      const userResponse = await fetch('http://localhost:3000/api/user/verify', {
        headers: {
          'auth-token': token
        }
      });

      if (userResponse.ok) {
        const userData = await userResponse.json();
        setUser(userData);

        // Add small delay before redirection
        setTimeout(() => {
          // Redirect based on role
          if (userData.role === 'admin' || userData.role === 'super_admin') {
            navigate('/admin');
          } else {
            navigate('/dashboard');
          }
        }, 100);
      }

      return { mfaRequired: false };
    } catch (err: any) {
      setError(err.message);
      return { mfaRequired: false };
    }
  };

  const completeMfaLogin = async (token: string) => {
    setError(null);
    try {
      if (!tempUserId) {
        throw new Error('No pending MFA verification');
      }
      
      // Include isSetupMode flag to tell backend this was a setup completion
      const isSetupMode = mfaSetupRequired;
      
      const response = await fetch('http://localhost:3000/api/user/login/verify-mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          userId: tempUserId, 
          token,
          rememberMe: rememberMeOption,
          isSetupMode
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(errorData || 'MFA verification failed');
      }

      const jwtToken = await response.text();
      
      
      localStorage.setItem('auth-token', jwtToken);
      
      // Get user info
      const userResponse = await fetch('http://localhost:3000/api/user/verify', {
        headers: {
          'auth-token': jwtToken
        }
      });
      
      if (userResponse.ok) {
        const userData = await userResponse.json();
        setUser(userData);
        setMfaRequired(false);
        setTempUserId(null);
        
        // Redirect based on role
        if (userData.role === 'admin' || userData.role === 'super_admin') {
          navigate('/admin');
        } else {
          navigate('/dashboard');
        }
      }

      // Reset MFA state at the end
      sessionStorage.removeItem('mfa-setup-in-progress');
      localStorage.removeItem('mfa-setup-block');
      setBlockRedirects(false);
      setMfaRequired(false);
      setMfaSetupRequired(false);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const register = async (username: string, email: string, password: string) => {
    setError(null);
    try {
      const response = await fetch('http://localhost:3000/api/user/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(errorData || 'Registration failed');
      }

      // Auto login after successful registration
      await login(email, password);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const logout = () => {
    localStorage.removeItem('auth-token');
    setUser(null);
    navigate('/');
  };

  const updateUser = (userData: Partial<{
    username: string;
    email: string;
    profileImage: string | null;
  }>) => {
    if (user) {
      setUser({
        ...user,
        ...userData
      });
    }
  };

  const refreshUserData = async () => {
    try {
      const token = localStorage.getItem('auth-token') || sessionStorage.getItem('auth-token');
      if (!token) return;
      
      const userResponse = await fetch('http://localhost:3000/api/profile', {
        headers: {
          'auth-token': token
        }
      });
      
      if (userResponse.ok) {
        const userData = await userResponse.json();
        setUser({
          ...user,
          ...userData
        });
      }
    } catch (error) {
      console.error('Error refreshing user data:', error);
    }
  };

  const resetMfaSetupState = () => {
    sessionStorage.removeItem('mfa-setup-in-progress');
    sessionStorage.removeItem('mfa-setup-token');
    sessionStorage.removeItem('temp-user-id');
    localStorage.removeItem('mfa-setup-block');
    setBlockRedirects(false);
    setMfaSetupRequired(false);
    setMfaRequired(false);
    setTempUserId(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        mfaRequired,
        mfaSetupRequired,
        tempUserId,
        login,
        completeMfaLogin,
        register,
        logout,
        updateUser,
        refreshUserData, 
        resetMfaSetupState,
        error
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};