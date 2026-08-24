import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Container, Link, Stack, TextField, Typography } from '@mui/material';
import { api, errorMessage } from '../api/client.js';
import { glass } from '../theme/tokens.js';

export const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim().toLowerCase());
      setSent(true);
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
            Reset your password
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Enter the email address on your account. If it matches a local account, a time-limited reset link is sent.
            Directory accounts must be reset in the corporate directory.
          </Typography>

          {sent ? (
            <Alert severity="success" sx={{ mb: 3 }}>
              If the address matches an account, a reset link is on its way. The link expires shortly, and the request has
              been recorded in the audit trail.
            </Alert>
          ) : (
            <form onSubmit={submit}>
              <Stack spacing={2.5}>
                {error && <Alert severity="error">{error}</Alert>}
                <TextField
                  label="Email address"
                  type="email"
                  size="medium"
                  required
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <Button type="submit" variant="contained" size="large" disabled={busy}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </Button>
              </Stack>
            </form>
          )}

          <Link component={RouterLink} to="/login" variant="body2" underline="hover" sx={{ display: 'inline-block', mt: 3 }}>
            ← Back to sign in
          </Link>
        </Box>
      </Container>
    </Box>
  );
};

export default ForgotPasswordPage;
