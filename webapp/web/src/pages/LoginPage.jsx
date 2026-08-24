import { useEffect, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Container,
  Divider,
  Link,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ShieldIcon from '@mui/icons-material/GppGood';
import LockIcon from '@mui/icons-material/LockOutlined';
import { useAuth } from '../auth/AuthContext.jsx';
import { api, errorMessage } from '../api/client.js';
import { glass, palette } from '../theme/tokens.js';

const HIGHLIGHTS = [
  'Directory sign-in with group-mapped roles',
  'Per-branch scans, queued with retry and audit trail',
  'Every action mirrored to syslog',
];

export const LoginPage = () => {
  const { login, user, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [provider, setProvider] = useState('auto');
  const [form, setForm] = useState({ username: '', password: '', mfaCode: '' });
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [ldapEnabled, setLdapEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate(location.state?.from || '/', { replace: true });
  }, [user, navigate, location.state]);

  useEffect(() => {
    // Public endpoint: the sign-in screen must know which methods to offer
    // before anyone is authenticated.
    api
      .authMethods()
      .then((info) => setLdapEnabled(Boolean(info.methods?.ldap)))
      .catch(() => setLdapEnabled(false));
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login({
        username: form.username.trim(),
        password: form.password,
        provider,
        ...(form.mfaCode ? { mfaCode: form.mfaCode.trim() } : {}),
      });
      if (result.mfaRequired) {
        setMfaRequired(true);
        setInfo('Enter the six-digit code from your authenticator app, or a recovery code.');
      } else if (result.mfaEnrollmentRequired) {
        setError('Multi-factor authentication is mandatory for administrators. Ask an admin to enrol your account.');
      }
    } catch (caught) {
      setError(errorMessage(caught, 'Sign-in failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        px: 2,
        py: 6,
      }}
    >
      <Container maxWidth="lg" disableGutters>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={0} sx={{ ...glass({ radius: 26 }), overflow: 'hidden', isolation: 'isolate' }}>
          <Box
            sx={{
              flex: 1.1,
              p: { xs: 4, md: 6 },
              color: '#fff',
              background: `linear-gradient(140deg, ${palette.brand[700]}, ${palette.brand[400]} 55%, #6f5bd0)`,
              display: { xs: 'none', md: 'flex' },
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: 520,
              // Explicit corners: a backdrop-filtered parent does not clip its children.
              borderRadius: '26px 0 0 26px',
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 3,
                  display: 'grid',
                  placeItems: 'center',
                  background: alpha('#ffffff', 0.18),
                  border: `1px solid ${alpha('#ffffff', 0.35)}`,
                }}
              >
                <ShieldIcon />
              </Box>
              <Typography variant="h4" sx={{ color: '#fff' }}>
                Sentinel Console
              </Typography>
            </Stack>

            <Box>
              <Typography variant="h1" sx={{ color: '#fff', mb: 1.5 }}>
                Find secrets before attackers do.
              </Typography>
              <Typography sx={{ color: alpha('#fff', 0.86), maxWidth: 460 }}>
                Register applications with their owners and repositories, scan every branch on demand, triage the
                findings and hand auditors a complete, tamper-evident trail.
              </Typography>
              <Stack spacing={1.25} sx={{ mt: 3.5 }}>
                {HIGHLIGHTS.map((item) => (
                  <Stack key={item} direction="row" spacing={1.25} alignItems="center">
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: alpha('#fff', 0.8) }} />
                    <Typography variant="body2" sx={{ color: alpha('#fff', 0.9) }}>
                      {item}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>

            <Typography variant="caption" sx={{ color: alpha('#fff', 0.7) }}>
              Authorised use only. All activity is logged and forwarded to the security information and event management
              platform.
            </Typography>
          </Box>

          <Box sx={{ flex: 1, p: { xs: 3.5, md: 5.5 }, minWidth: { md: 420 } }}>
            <Stack spacing={0.75} sx={{ mb: 3 }}>
              <Typography variant="h2">Sign in</Typography>
              <Typography variant="body2" color="text.secondary">
                Use your corporate directory account, or a local platform account.
              </Typography>
            </Stack>

            {sessionExpired && !error && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Your session expired. Please sign in again.
              </Alert>
            )}
            {info && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {info}
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <form onSubmit={submit}>
              <Stack spacing={2.25}>
                {ldapEnabled && (
                  <ToggleButtonGroup
                    exclusive
                    fullWidth
                    size="small"
                    value={provider}
                    onChange={(_event, value) => value && setProvider(value)}
                  >
                    <ToggleButton value="auto">Automatic</ToggleButton>
                    <ToggleButton value="ldap">Directory</ToggleButton>
                    <ToggleButton value="local">Local</ToggleButton>
                  </ToggleButtonGroup>
                )}

                <TextField
                  label="Username"
                  size="medium"
                  autoComplete="username"
                  autoFocus
                  required
                  value={form.username}
                  onChange={(event) => setForm((state) => ({ ...state, username: event.target.value }))}
                />
                <TextField
                  label="Password"
                  type="password"
                  size="medium"
                  autoComplete="current-password"
                  required
                  value={form.password}
                  onChange={(event) => setForm((state) => ({ ...state, password: event.target.value }))}
                />
                {mfaRequired && (
                  <TextField
                    label="Verification code"
                    size="medium"
                    autoFocus
                    inputProps={{ inputMode: 'numeric', maxLength: 24 }}
                    helperText="Six-digit authenticator code, or one of your recovery codes"
                    value={form.mfaCode}
                    onChange={(event) => setForm((state) => ({ ...state, mfaCode: event.target.value }))}
                  />
                )}

                <Button type="submit" variant="contained" size="large" disabled={busy} startIcon={<LockIcon />}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Link component={RouterLink} to="/forgot-password" variant="body2" underline="hover">
                    Forgot password?
                  </Link>
                  <Typography variant="caption" color="text.secondary">
                    Need access? Contact your security administrator.
                  </Typography>
                </Stack>

                <Divider sx={{ pt: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  Repeated failed attempts temporarily lock the account and raise an alert in the audit trail.
                </Typography>
              </Stack>
            </form>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
};

export default LoginPage;
