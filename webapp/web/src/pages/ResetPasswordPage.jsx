import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Container, LinearProgress, Link, Stack, TextField, Typography } from '@mui/material';
import { api, errorMessage } from '../api/client.js';
import { glass } from '../theme/tokens.js';

/** Mirrors the server policy: length plus three of four character classes. */
export const passwordStrength = (value = '') => {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  const lengthScore = Math.min(1, value.length / 16);
  const score = Math.round((classes / 4) * 60 + lengthScore * 40);
  const acceptable = value.length >= 12 && classes >= 3;
  return { score, acceptable, classes };
};

export const ResetPasswordPage = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const token = params.get('token') || '';
  const strength = passwordStrength(form.password);

  const submit = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setError('The two passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword({ token, password: form.password });
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2 }}>
      <Container maxWidth="sm" disableGutters>
        <Box sx={{ ...glass({ radius: 22 }), p: { xs: 3.5, md: 5 } }}>
          <Typography variant="h2" gutterBottom>
            Choose a new password
          </Typography>

          {!token && <Alert severity="error">This reset link is missing its token. Request a new link.</Alert>}
          {done ? (
            <Alert severity="success">Password updated. Redirecting you to sign in…</Alert>
          ) : (
            token && (
              <form onSubmit={submit}>
                <Stack spacing={2.5} sx={{ mt: 2 }}>
                  {error && <Alert severity="error">{error}</Alert>}
                  <TextField
                    label="New password"
                    type="password"
                    size="medium"
                    required
                    autoFocus
                    value={form.password}
                    onChange={(event) => setForm((state) => ({ ...state, password: event.target.value }))}
                    helperText="At least 12 characters, using three of: lowercase, uppercase, digits, symbols"
                  />
                  <Box>
                    <LinearProgress
                      variant="determinate"
                      value={strength.score}
                      color={strength.acceptable ? 'success' : 'warning'}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {strength.acceptable ? 'Meets the policy' : 'Does not meet the policy yet'}
                    </Typography>
                  </Box>
                  <TextField
                    label="Confirm new password"
                    type="password"
                    size="medium"
                    required
                    value={form.confirm}
                    onChange={(event) => setForm((state) => ({ ...state, confirm: event.target.value }))}
                  />
                  <Button type="submit" variant="contained" size="large" disabled={busy || !strength.acceptable}>
                    {busy ? 'Updating…' : 'Update password'}
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    Updating your password signs out every other active session.
                  </Typography>
                </Stack>
              </form>
            )
          )}

          <Link component={RouterLink} to="/login" variant="body2" underline="hover" sx={{ display: 'inline-block', mt: 3 }}>
            ← Back to sign in
          </Link>
        </Box>
      </Container>
    </Box>
  );
};

export default ResetPasswordPage;
