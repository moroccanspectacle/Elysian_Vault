const API_URL = 'http://localhost:3000/api';
import { VaultFile } from "../pages/VaultPage";

interface SystemSettings {
  enforceTwo2FA: boolean;
  fileExpiration: boolean;
  maxFileSize: number;
  storageQuota: number;
}

export const api = {
  authFetch: async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('auth-token');
    const mfaSetupToken = sessionStorage.getItem('mfa-setup-token');
    
    console.log(`Request to ${url}:`, {
      hasAuthToken: !!token,
      hasMfaSetupToken: !!mfaSetupToken,
      setupTokenLength: mfaSetupToken?.length,
      isMfaSetupRequest: url.includes('/mfa/')
    });
    
    const defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Merge default headers with provided options.headers
    const mergedHeaders: Record<string, string> = { ...defaultHeaders, ...(options.headers as Record<string, string> || {}) };

    // Add auth token if available
    if (token) {
      mergedHeaders['auth-token'] = token;
    } else {
      console.log('[authFetch] No auth-token found in localStorage.');
    }

    // Add MFA setup token if available
    if (mfaSetupToken) {
      mergedHeaders['mfa-setup-token'] = mfaSetupToken;
    }

    // Add Logging for Final Options
    const finalOptions = {
      ...options,
      headers: mergedHeaders
    };
    // Log only for the specific debugging path 
    if (url.startsWith('/vault/access/')) {
        console.log(`[authFetch] Final options for ${url}:`, JSON.stringify(finalOptions, null, 2));
    }

    // Make the request with final options
    const response = await fetch(`${API_URL}${url}`, finalOptions);
    
    // Log the response status
    console.log(`Response from ${url}:`, {
      status: response.status,
      ok: response.ok
    });
    
    if (response.status === 401) {
      if (url.includes('/mfa/')) {
        console.error('Authentication failed for MFA setup');
        throw new Error('Authentication failed for MFA setup');
      } else {
        localStorage.removeItem('auth-token');
        if (!url.includes('/login')) {
          window.location.href = '/login';
        }
        throw new Error('Authentication required');
      }
    }
    
    return response;
  },

  // File operations
  files: {
    list: async () => {
      const response = await api.authFetch('/files/list');
      return response.json();
    },
    
    // Update the upload method to accept teamId parameter
    upload: async (file: File, teamId?: string, onProgress?: (progress: number) => void) => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        
        formData.append('file', file);
        
        // Add teamId to the form data
        if (teamId) {
          formData.append('teamId', teamId);
        }
        
        xhr.open('POST', `${API_URL}/files/upload`);
        
        const token = localStorage.getItem('auth-token');
        if (token) {
          xhr.setRequestHeader('auth-token', token);
        }
        
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && onProgress) {
            const progress = Math.round((event.loaded / event.total) * 100);
            onProgress(progress);
          }
        });
        
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve(data);
            } catch (e) {
              reject(new Error('Invalid response'));
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              reject(new Error(errorData.error || 'Upload failed'));
            } catch (e) {
              reject(new Error('Upload failed'));
            }
          }
        };
        
        xhr.onerror = () => {
          reject(new Error('Network error'));
        };
        
        xhr.send(formData);
      });
    },
    
    download: async (fileId: string) => {
      try {
        const token = localStorage.getItem('auth-token');
        const response = await fetch(`${API_URL}/files/download/${fileId}`, {
          headers: {
            'auth-token': token || ''
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to download file');
        }
        
        // Get the blob data from response
        const blob = await response.blob();
        
        // Create download link and trigger download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Get filename from Content-Disposition header
        const contentDisposition = response.headers.get('Content-Disposition');
        const filenameMatch = contentDisposition && contentDisposition.match(/filename="(.+)"/);
        const filename = filenameMatch ? filenameMatch[1] : `file-${fileId}`;
        
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // Clean up
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (error) {
        console.error('Download error:', error);
        throw error;
      }
    },
    
    delete: async (fileId: string) => {
      const response = await api.authFetch(`/files/${fileId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        let errorMsg = `Failed to delete file (Status: ${response.status})`;
        try {
            const errorData = await response.json();
            errorMsg = errorData.error || errorMsg;
        } catch (e) {
            // If parsing JSON fail use the status text or default message
            errorMsg = response.statusText || errorMsg;
            console.error("Failed to parse error response as JSON:", await response.text().catch(() => ''));
        }
        throw new Error(errorMsg);
      }
      return response.json();
    },

    verifyIntegrity: async (fileId: string) => {
      const response = await api.authFetch(`/files/verify/${fileId}`);
      return response.json();
    },

    getViewUrl: async (fileId: string): Promise<string> => {
      // Get auth token
      const token = localStorage.getItem('auth-token');
      
      // This will return a URL that can be used with the DocumentViewer
      return `${API_URL}/files/view/${fileId}?token=${encodeURIComponent(token || '')}`;
    },

    getSettings: async () => {
      const response = await api.authFetch('/files/settings');
      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(errorData || 'Failed to fetch file settings');
      }
      return response.json();
    }
  },
  profile: {
    get: async () => {
      const response = await api.authFetch('/profile');
      return response.json();
    },
    
    update: async (data: { username?: string; email?: string }) => {
      const response = await api.authFetch('/profile', {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      return response.json();
    },
    
    changePassword: async (data: { currentPassword: string; newPassword: string }) => {
      const response = await api.authFetch('/profile/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to change password');
      }
      
      return response.json();
    },
    
    uploadImage: async (file: File) => {
      const formData = new FormData();
      formData.append('profileImage', file);
      
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`${API_URL}/profile/image`, {
        method: 'PUT',
        headers: {
          'auth-token': token || ''
        },
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Failed to upload image');
      }
      
      return response.json();
    }
  },
  mfa: {
    setup: async () => {
      // Log before making the request
      console.log('Setup token before request:', sessionStorage.getItem('mfa-setup-token'));
      
      const response = await api.authFetch('/mfa/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        // Adding empty body to ensure proper POST request
        body: JSON.stringify({})
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to set up MFA');
      }
      
      return response.json();
    },
    verifySetup: async (token: string) => {
      const response = await api.authFetch('/mfa/verify-setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({token})
      });
      
      // Check if response is ok before trying to parse JSON
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to verify MFA setup');
      }
      
      return response.json();
    },
    verify: async (userId: string, token: string) => {
      const response = await fetch(`${API_URL}/mfa/verify`, {
        method: 'POST', 
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({userId, token})
      });
      return response.json();
    },
    disable: async (token: string) => {
      const response = await api.authFetch('/mfa/disable', {
        method: 'POST', 
        body: JSON.stringify({token})
      });
      return response.json();
    },
    directSetup: async () => {
      const mfaSetupToken = sessionStorage.getItem('mfa-setup-token');
      const token = localStorage.getItem('auth-token');
      
      console.log('Direct setup using:', {
        setupToken: mfaSetupToken ? 'present' : 'missing',
        authToken: token ? 'present' : 'missing'
      });
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (mfaSetupToken) {
        headers['mfa-setup-token'] = mfaSetupToken;
      }
      
      if (token) {
        headers['auth-token'] = token;
      }
      
      console.log('Request headers:', headers);
      
      const response = await fetch(`${API_URL}/mfa/debug-setup`, { // Use debug endpoint
        method: 'POST',
        headers,
        body: JSON.stringify({
          setupToken: mfaSetupToken,
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Setup failed with status:', response.status, errorText);
        throw new Error(errorText || 'Failed to set up MFA');
      }
      
      return response.json();
    },
    emergencySetup: async (userId: string) => {
      const mfaSetupToken = sessionStorage.getItem('mfa-setup-token');
      
      console.log('Emergency setup using userId:', userId);
      console.log('We have token:', mfaSetupToken ? 'yes' : 'no');
      
      const response = await fetch(`${API_URL}/mfa/debug-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          setupToken: mfaSetupToken
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to set up MFA');
      }
      
      return response.json();
    }
  }, 
  activities: {
    list: async (params: {page?: number; limit?: number; action?: string} = {}) => {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.limit) queryParams.append('limit', params.limit.toString());
      if(params.action && params.action !== 'all') queryParams.append('action', params.action);
      
      const response = await api.authFetch(`/activities?${queryParams.toString()}`); 
      return response.json();
    }
  },
  shares: {
    create: async (data: { 
      fileId: string; 
      permissions?: { canView: boolean; canEdit: boolean; canDownload: boolean }; 
      expirationDays?: number;
      recipientEmail?: string;
    }) => {
      const response = await api.authFetch('/shares/share', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      return response.json();
    },
    
    getFileShares: async (fileId: string) => {
      const response = await api.authFetch(`/shares/file/${fileId}`);
      return response.json();
    },
    
    update: async (
      shareId: string, 
      data: { 
        permissions?: { canView: boolean; canEdit: boolean; canDownload: boolean }; 
        expirationDays?: number;
        isActive?: boolean;
      }
    ) => {
      const response = await api.authFetch(`/shares/${shareId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      return response.json();
    },
    
    delete: async (shareId: string) => {
      const response = await api.authFetch(`/shares/${shareId}`, {
        method: 'DELETE'
      });
      return response.json();
    },

    // Get all shares created by the current user
    listMyShares: async () => {
      const response = await api.authFetch('/shares/myshares'); // Using authFetch instead
      return response.json();
    },
    
    // Update a share's active status
    updateStatus: async (shareId: number, isActive: boolean) => {
      const response = await fetch(`${API_URL}/shares/${shareId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'auth-token': localStorage.getItem('auth-token') || '',
        },
        body: JSON.stringify({ isActive }),
      });
      if (!response.ok) {
        throw new Error(`Failed to update share: ${response.status}`);
      }
      return response.json();
    }
  },
  teams: {
    list: async () => {
      const response = await api.authFetch('/teams');
      return response.json();
    },

    create: async (data: { name: string; description?: string; storageQuota?: number }) => {
      const response = await api.authFetch('/teams', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      return response.json();
    },

    getTeam: async (teamId: string) => {
      const response = await api.authFetch(`/teams/${teamId}`);
      return response.json();
    },

    getMembers: async (teamId: string) => {
      const response = await api.authFetch(`/teams/${teamId}/members`);
      return response.json();
    },

    getTeamFiles: async (teamId: string) => {
      const response = await api.authFetch(`/teams/${teamId}/files`);
      return response.json();
    },

    searchInvitees: async (teamId: string, searchTerm: string): Promise<User[]> => {
      const queryParams = new URLSearchParams({ search: searchTerm });
      const response = await api.authFetch(`/teams/${teamId}/search-invitees?${queryParams.toString()}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to search users');
      }
      return response.json();
    },

    inviteMember: async (teamId: string, userId: number, role: string) => {
      const response = await api.authFetch(`/teams/${teamId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ userId, role }) // Send userId instead of email
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to invite member');
      }
      return response.json();
    },

    updateStorageQuota: async (teamId: string, storageQuota: number) => {
      const response = await api.authFetch(`/teams/${teamId}/quota`, {
        method: 'PUT',
        body: JSON.stringify({ storageQuota })
      });
      return response.json();
    },

    // Update team details
    update: async (teamId: string, data: { name: string; description?: string; storageQuota?: number }) => {
      const response = await api.authFetch(`/teams/${teamId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      return response.json();
    },

    // Update team avatar
    updateAvatar: async (teamId: string, formData: FormData) => {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`${API_URL}/teams/${teamId}/avatar`, {
        method: 'POST',
        headers: {
          'auth-token': token || ''
        },
        body: formData
      });
      if (!response.ok) {
        throw new Error('Failed to update avatar');
      }
      return response.json();
    },

    // Remove a member from team
    removeMember: async (teamId: string, memberId: string) => {
      const response = await api.authFetch(`/teams/${teamId}/members/${memberId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to remove member');
      }
      return response.json();
    },

    updateMemberRole: async (teamId: string, memberId: string, role: string) => {
      const response = await api.authFetch(`/teams/${teamId}/members/${memberId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update role');
      }
      return response.json();
    },

    // Resend invitation
    resendInvite: async (teamId: string, memberId: string) => {
      const response = await api.authFetch(`/teams/${teamId}/members/${memberId}/resend`, {
        method: 'POST'
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to resend invite');
      }
      return response.json();
    },

    // Delete team file
    deleteFile: async (teamId: string, fileId: string) => {
      const response = await api.authFetch(`/teams/${teamId}/files/${fileId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete file');
      }
      return response.json();
    },

    // Get team settings
    getSettings: async (teamId: string) => {
      const response = await api.authFetch(`/teams/${teamId}/settings`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get settings');
      }
      return response.json();
    },

    // Update team settings
    updateSettings: async (teamId: string, settings: any) => {
      const response = await api.authFetch(`/teams/${teamId}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionStorage.getItem('sensitive-op-token') && {
            'sensitive-op-token': sessionStorage.getItem('sensitive-op-token') || ''
          })
        },
        body: JSON.stringify(settings)
      });
      sessionStorage.removeItem('sensitive-op-token');

      if (!response.ok) {
        const errorData = await response.json();
        // Check for 2FA requirement
        if (response.status === 403 && errorData.error === '2FA_REQUIRED') {
          throw new Error('2FA_REQUIRED');
        }
        throw new Error(errorData.error || 'Failed to update settings');
      }
      return response.json();
    },

    // Delete team
    deleteTeam: async (teamId: string) => {
      const response = await api.authFetch(`/teams/${teamId}`, {
        method: 'DELETE',
        headers: {
          ...(sessionStorage.getItem('sensitive-op-token') && {
            'sensitive-op-token': sessionStorage.getItem('sensitive-op-token') || ''
          })
        }
      });
      // Clear token after use
      sessionStorage.removeItem('sensitive-op-token');

      if (!response.ok) {
        const errorData = await response.json();
        // Check for 2FA requirement
        if (response.status === 403 && errorData.error === '2FA_REQUIRED') {
          throw new Error('2FA_REQUIRED');
        }
        throw new Error(errorData.error || 'Failed to delete team');
      }
      return response.json();
    }
  },
  notifications: {
    // Get team invitations
    getInvitations: async () => {
      const response = await api.authFetch('/notifications/invitations');
      return response.json();
    },
    
    // Accept an invitation
    acceptInvitation: async (invitationId: string) => {
      const response = await api.authFetch(`/notifications/invitations/${invitationId}/accept`, {
        method: 'POST'
      });
      return response.json();
    },
    
    // Decline an invitation
    declineInvitation: async (invitationId: string) => {
      const response = await api.authFetch(`/notifications/invitations/${invitationId}/decline`, {
        method: 'POST'
      });
      return response.json();
    }
  },
  auth: {
    // Verify 2FA code
    verify2FA: async (code: string) => {
      const response = await api.authFetch('/auth/verify-2fa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code })
      });
      return response.json();
    },

    forgotPassword: async (email: string) => {
      const response = await fetch(`${API_URL}/user/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      });
      return response.json();
    },
    
    // Verify reset token
    verifyResetToken: async (token: string) => {
      const response = await fetch(`${API_URL}/auth/reset-password/${token}`);
      return response.json();
    },
    
    resetPassword: async (token: string, password: string) => {
      const response = await fetch(`${API_URL}/auth/reset-password/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });
      return response.json();
    },

    verifySetupToken: async (token: string) => {
      const response = await fetch(`${API_URL}/auth/verify-setup-token/${token}`);
      
      if (!response.ok) {
        throw new Error('Invalid or expired setup token');
      }
      
      return response.json();
    },
    
    setupPassword: async (token: string, password: string) => {
      const response = await fetch(`${API_URL}/auth/setup-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token, password })
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to set password');
      }
      
      return response.json();
    },

    getActivityLogs: async (params: { page?: number; limit?: number; action?: string } = {}) => {
      const queryParams = new URLSearchParams();
      if (params.page !== undefined) queryParams.append('page', params.page.toString());
      if (params.limit !== undefined) queryParams.append('limit', params.limit.toString());
      if (params.action) queryParams.append('action', params.action);

      const response = await api.authFetch(`/activities?${queryParams.toString()}`); // #file:activities.js

      if (!response.ok) {
         
         const errorData = await response.json().catch(() => ({ error: 'Failed to load activity logs' }));
         throw new Error(errorData.error || 'Failed to load activity logs');
      }
      return response.json();
    },
  },
  admin: {
    // User management
    listUsers: async (params: { page?: number; limit?: number; search?: string } = {}) => {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.limit) queryParams.append('limit', params.limit.toString());
      if (params.search) queryParams.append('search', params.search); // Fix: add the search value
      
      const response = await api.authFetch(`/admin/users?${queryParams.toString()}`);
      return response.json();
    },
    
    updateUser: async (userId: string, data: { 
      username?: string;
      email?: string;
      role?: 'user' | 'admin';
      status?: 'active' | 'suspended';
    }) => {
      const response = await api.authFetch(`/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return response.json();
    },
    
    // Get details for a specific file
    getFileDetails: async (fileId: string) => {
      const response = await api.authFetch(`/admin/files/${fileId}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch file details');
      }
      return response.json();
    },

    
    deleteFile: async (fileId: string) => {
      const response = await api.authFetch(`/admin/files/${fileId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete file');
      }
      return response.json(); 
    },

    // List all files
    listAllFiles: async (params: { page?: number; limit?: number; search?: string } = {}) => {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.limit) queryParams.append('limit', params.limit.toString());
      if (params.search) queryParams.append('search', params.search);
      
      const response = await api.authFetch(`/admin/files?${queryParams.toString()}`);
      return response.json();
    },
    
    // System overview
    getSystemOverview: async () => {
      const response = await api.authFetch('/admin/stats/overview');
      return response.json();
    },
    
    // System settings
    getSystemSettings: async () => {
      const response = await api.authFetch('/admin/settings');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch system settings');
      }
      return response.json();
    },
    
    updateSystemSettings: async (settings: SystemSettings) => {
      const response = await api.authFetch('/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update system settings');
      }
      return response.json();
    },
    
    // Activity logs
    getActivityLogs: async (params: { 
      page?: number; 
      limit?: number; 
      userId?: string;
      action?: string;
      startDate?: string;
      endDate?: string;
    } = {}) => {
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
      
      const response = await api.authFetch(`/admin/activities?${queryParams.toString()}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to load admin activity logs' }));
        throw new Error(errorData.error || 'Failed to load admin activity logs');
      }
      return response.json();
    },

    createUser: async (data: { username: string; email: string }) => {
      const response = await api.authFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create user');
      }
      
      return response.json();
    },

    // Department management
    getDepartments: async () => {
      const response = await api.authFetch('/admin/departments');
      if (!response.ok) {
        throw new Error('Failed to fetch departments');
      }
      return response.json();
    },
    
    createDepartment: async (departmentData: any) => {
      const response = await api.authFetch('/admin/departments', {
        method: 'POST',
        body: JSON.stringify(departmentData)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create department');
      }
      return response.json();
    },
    
    updateDepartment: async (id: number, departmentData: any) => {
      const response = await api.authFetch(`/admin/departments/${id}`, {
        method: 'PUT',
        body: JSON.stringify(departmentData)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update department');
      }
      return response.json();
    },
    
    deleteDepartment: async (id: number) => {
      const response = await api.authFetch(`/admin/departments/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete department');
      }
      return response.json();
    }
  },
  vault: {
    list: async (): Promise<VaultFile[]> => {
      const response = await api.authFetch('/vault/list');
      if (!response.ok) {
        throw new Error('Failed to list vault files');
      }
      return response.json();
    },
    
    
    add: async (fileId: string, pin: string, options?: { selfDestruct?: boolean, destructAfter?: Date | null }) => {
      
      const body: any = { pin }; // Only send pin and options in body
      if (options?.selfDestruct !== undefined) {
        body.selfDestruct = options.selfDestruct;
      }
      if (options?.destructAfter) {
        // Ensure date is sent in ISO format for backend compatibility
        body.destructAfter = options.destructAfter.toISOString();
      }

      
      const response = await api.authFetch(`/vault/add/${fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to add file to vault' }));
        throw new Error(errorData.message || errorData.error || 'Failed to add file to vault');
      }
      return response.json();
    },
   

    access: async (vaultFileId: string, pin: string) => {
      const response = await api.authFetch(`/vault/access/${vaultFileId}`, {
        method: 'GET',
        headers: {
          'X-Vault-PIN': pin
        }
      });
      if (!response.ok) {
        const errorData = await response.json();
        const error = new Error(errorData.message || 'Failed to access vault file');
        (error as any).needsPin = errorData.needsPin === true;
        throw error;
      }
      return response.json();
    },
    
    remove: async (vaultFileId: string) => {
      
      const response = await api.authFetch(`/vault/${vaultFileId}`, { method: 'DELETE' }); 
      if (!response.ok) {
         const errorData = await response.json();
         throw new Error(errorData.message ||'Failed to remove file from vault');
      }
      return response.json();
    },
    getPermissions: async () => {
      const response = await api.authFetch('/vault/permissions');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to get vault permissions');
      }
      return response.json();
    }
  }
};
interface User {
  id: number;
  username: string;
  email: string;
  profileImage?: string;
}