import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

export const client = axios.create({ baseURL: BASE_URL, withCredentials: true, timeout: 30_000 });

let accessToken = null;
let onSessionLost = null;
let refreshInFlight = null;

export const setAccessToken = (token) => {
  accessToken = token;
  if (token) localStorage.setItem('sentinel.access', token);
  else localStorage.removeItem('sentinel.access');
};

export const getAccessToken = () => accessToken || localStorage.getItem('sentinel.access');
export const setSessionLostHandler = (handler) => {
  onSessionLost = handler;
};

client.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Transparently refreshes an expired access token once per failure, replaying
 * the original request. Concurrent 401s share a single refresh call.
 */
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const code = error.response?.data?.error?.code;

    if (status === 401 && code === 'token_expired' && original && !original.__retried) {
      original.__retried = true;
      try {
        refreshInFlight = refreshInFlight || client.post('/auth/refresh', {});
        const { data } = await refreshInFlight;
        refreshInFlight = null;
        setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return client(original);
      } catch (refreshError) {
        refreshInFlight = null;
        setAccessToken(null);
        onSessionLost?.();
        return Promise.reject(refreshError);
      }
    }
    if (status === 401 && !original?.url?.includes('/auth/login')) {
      setAccessToken(null);
      onSessionLost?.();
    }
    return Promise.reject(error);
  },
);

/** Normalises server, network and validation errors into one readable string. */
export const errorMessage = (error, fallback = 'Something went wrong') => {
  const payload = error?.response?.data?.error;
  if (!payload) return error?.message || fallback;
  if (payload.details?.length) return payload.details.map((detail) => `${detail.field}: ${detail.message}`).join('; ');
  return payload.message || fallback;
};

export const api = {
  login: (payload) => client.post('/auth/login', payload).then((r) => r.data),
  logout: () => client.post('/auth/logout', {}).then((r) => r.data),
  logoutAll: () => client.post('/auth/logout-all', {}).then((r) => r.data),
  me: () => client.get('/auth/me').then((r) => r.data),
  forgotPassword: (email) => client.post('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (payload) => client.post('/auth/reset-password', payload).then((r) => r.data),
  changePassword: (payload) => client.post('/auth/change-password', payload).then((r) => r.data),
  startMfa: () => client.post('/auth/mfa/enroll', {}).then((r) => r.data),
  confirmMfa: (code) => client.post('/auth/mfa/confirm', { code }).then((r) => r.data),
  disableMfa: (currentPassword) => client.post('/auth/mfa/disable', { currentPassword }).then((r) => r.data),

  dashboard: (params) => client.get('/dashboard/overview', { params }).then((r) => r.data),
  activity: (params) => client.get('/dashboard/activity', { params }).then((r) => r.data),

  projects: (params) => client.get('/projects', { params }).then((r) => r.data),
  project: (id) => client.get(`/projects/${id}`).then((r) => r.data),
  projectStats: (id) => client.get(`/projects/${id}/stats`).then((r) => r.data),
  createProject: (payload) => client.post('/projects', payload).then((r) => r.data),
  updateProject: (id, payload) => client.patch(`/projects/${id}`, payload).then((r) => r.data),
  archiveProject: (id) => client.delete(`/projects/${id}`).then((r) => r.data),

  scans: (params) => client.get('/scans', { params }).then((r) => r.data),
  scan: (scanId) => client.get(`/scans/${scanId}`).then((r) => r.data),
  createScan: (payload) => client.post('/scans', payload).then((r) => r.data),
  bulkScan: (payload) => client.post('/scans/bulk', payload).then((r) => r.data),
  cancelScan: (scanId) => client.post(`/scans/${scanId}/cancel`, {}).then((r) => r.data),
  retryScan: (scanId) => client.post(`/scans/${scanId}/retry`, {}).then((r) => r.data),

  findings: (params) => client.get('/findings', { params }).then((r) => r.data),
  finding: (id) => client.get(`/findings/${id}`).then((r) => r.data),
  updateFinding: (id, payload) => client.patch(`/findings/${id}`, payload).then((r) => r.data),
  bulkFindings: (payload) => client.post('/findings/bulk', payload).then((r) => r.data),
  exportFindingsUrl: (params) => `${BASE_URL}/findings/export?${new URLSearchParams(params)}`,

  users: (params) => client.get('/users', { params }).then((r) => r.data),
  createUser: (payload) => client.post('/users', payload).then((r) => r.data),
  updateUser: (id, payload) => client.patch(`/users/${id}`, payload).then((r) => r.data),
  deleteUser: (id) => client.delete(`/users/${id}`).then((r) => r.data),
  resetUserPassword: (id) => client.post(`/users/${id}/reset-password`, {}).then((r) => r.data),
  unlockUser: (id) => client.post(`/users/${id}/unlock`, {}).then((r) => r.data),
  updateProfile: (payload) => client.patch('/users/me', payload).then((r) => r.data),

  auditLogs: (params) => client.get('/audit-logs', { params }).then((r) => r.data),
  auditFacets: () => client.get('/audit-logs/facets').then((r) => r.data),
  syslogStatus: () => client.get('/audit-logs/syslog/status').then((r) => r.data),
  testSyslog: () => client.post('/audit-logs/syslog/test', {}).then((r) => r.data),

  authMethods: () => client.get('/system/auth-methods').then((r) => r.data),
  health: () => client.get('/system/health').then((r) => r.data),
  config: () => client.get('/system/config').then((r) => r.data),
  testSmtp: (to) => client.post('/system/test/smtp', { to }).then((r) => r.data),
  testLdap: () => client.post('/system/test/ldap', {}).then((r) => r.data),
};

export default api;
