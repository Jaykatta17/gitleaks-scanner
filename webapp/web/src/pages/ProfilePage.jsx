import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SecurityIcon from '@mui/icons-material/Security';
import PageHeader from '../components/PageHeader.jsx';
import GlassCard from '../components/GlassCard.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api, errorMessage } from '../api/client.js';
import { passwordStrength } from './ResetPasswordPage.jsx';
import { roleLabel } from '../theme/tokens.js';

export const ProfilePage = () => {
  const { user, refreshUser, logout } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState({ displayName: user?.displayName || '', department: user?.department || '' });
  const [preferences, setPreferences] = useState(user?.notificationPreferences || {});
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [enrollment, setEnrollment] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [busy, setBusy] = useState(null);
  const strength = passwordStrength(passwords.newPassword);
  const isLocal = user?.authProvider === 'local';

  const saveProfile = async () => {
    setBusy('profile');
    try {
      await api.updateProfile({ ...profile, notificationPreferences: preferences });
      await refreshUser();
      toast.success('Profile updated');
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async () => {
    if (passwords.newPassword !== passwords.confirm) {
      toast.error('The two new passwords do not match');
      return;
    }
    setBusy('password');
    try {
      await api.changePassword({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      toast.success('Password changed — other sessions were signed out');
      setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
      await refreshUser();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const startEnrollment = async () => {
    setBusy('mfa');
    try {
      setEnrollment(await api.startMfa());
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const confirmEnrollment = async () => {
    setBusy('mfa');
    try {
      const { recoveryCodes: codes } = await api.confirmMfa(mfaCode.trim());
      setRecoveryCodes(codes);
      setEnrollment(null);
      setMfaCode('');
      await refreshUser();
      toast.success('Multi-factor authentication enabled');
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const disableMfa = async () => {
    setBusy('mfa');
    try {
      await api.disableMfa(passwords.currentPassword);
      await refreshUser();
      toast.info('Multi-factor authentication disabled');
    } catch (caught) {
      toast.error(errorMessage(caught, 'Confirm your current password above to disable MFA'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Profile & security"
        description="Your account details, notification preferences and authentication factors."
        actions={
          <Button
            variant="outlined"
            color="inherit"
            onClick={async () => {
              await api.logoutAll();
              await logout();
            }}
          >
            Sign out everywhere
          </Button>
        }
      />

      {user?.mustChangePassword && (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          Your password was issued by an administrator and must be changed before you continue.
        </Alert>
      )}

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <GlassCard title="Account" subtitle={`${user?.username} · ${roleLabel[user?.role] || user?.role}`}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1}>
                <Chip size="small" label={user?.authProvider === 'ldap' ? 'Directory account' : 'Local account'} variant="outlined" />
                <Chip size="small" label={user?.status} color={user?.status === 'active' ? 'success' : 'default'} />
                {user?.mfa?.enabled && <Chip size="small" color="success" icon={<SecurityIcon />} label="MFA on" />}
              </Stack>
              <TextField label="Display name" value={profile.displayName} onChange={(event) => setProfile((state) => ({ ...state, displayName: event.target.value }))} />
              <TextField label="Department" value={profile.department} onChange={(event) => setProfile((state) => ({ ...state, department: event.target.value }))} />
              <TextField label="Email" value={user?.email || ''} disabled helperText="Managed by an administrator or the directory" />
              <Divider />
              <Typography variant="subtitle2" color="text.secondary">
                NOTIFICATIONS
              </Typography>
              {[
                ['scanCompleted', 'Scan completed for applications I can see'],
                ['criticalFinding', 'Critical secret detected'],
                ['weeklyDigest', 'Weekly exposure digest'],
              ].map(([key, label]) => (
                <FormControlLabel
                  key={key}
                  control={<Switch checked={Boolean(preferences[key])} onChange={(event) => setPreferences((state) => ({ ...state, [key]: event.target.checked }))} />}
                  label={label}
                />
              ))}
              <Button variant="contained" onClick={saveProfile} disabled={busy === 'profile'}>
                Save changes
              </Button>
            </Stack>
          </GlassCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <Stack spacing={2.5}>
            <GlassCard title="Password" subtitle={isLocal ? 'Local credentials' : 'Managed in the corporate directory'}>
              {isLocal ? (
                <Stack spacing={2}>
                  <TextField type="password" label="Current password" value={passwords.currentPassword} onChange={(event) => setPasswords((state) => ({ ...state, currentPassword: event.target.value }))} />
                  <TextField type="password" label="New password" value={passwords.newPassword} onChange={(event) => setPasswords((state) => ({ ...state, newPassword: event.target.value }))} />
                  <Box>
                    <LinearProgress variant="determinate" value={strength.score} color={strength.acceptable ? 'success' : 'warning'} />
                    <Typography variant="caption" color="text.secondary">
                      {strength.acceptable ? 'Meets the policy' : 'At least 12 characters, three character classes'}
                    </Typography>
                  </Box>
                  <TextField type="password" label="Confirm new password" value={passwords.confirm} onChange={(event) => setPasswords((state) => ({ ...state, confirm: event.target.value }))} />
                  <Button variant="contained" onClick={changePassword} disabled={busy === 'password' || !strength.acceptable || !passwords.currentPassword}>
                    Change password
                  </Button>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  This account authenticates against the corporate directory. Change your password there; the platform never
                  stores it.
                </Typography>
              )}
            </GlassCard>

            <GlassCard title="Multi-factor authentication" subtitle="Time-based one-time codes (TOTP)">
              {user?.mfa?.enabled ? (
                <Stack spacing={2}>
                  <Alert severity="success">Enabled. You are asked for a code at every sign-in.</Alert>
                  <Typography variant="body2" color="text.secondary">
                    Disabling MFA requires your current password (enter it in the password panel).
                  </Typography>
                  <Button color="error" variant="outlined" onClick={disableMfa} disabled={busy === 'mfa' || (isLocal && !passwords.currentPassword)}>
                    Disable MFA
                  </Button>
                </Stack>
              ) : enrollment ? (
                <Stack spacing={2} alignItems="flex-start">
                  <Typography variant="body2">Scan this code with your authenticator app, then enter the six-digit code it shows.</Typography>
                  <Box component="img" src={enrollment.qrDataUrl} alt="Authenticator enrolment QR code" sx={{ width: 200, height: 200, borderRadius: 2 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                    {enrollment.secret}
                  </Typography>
                  <TextField label="Verification code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputProps={{ inputMode: 'numeric', maxLength: 6 }} />
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={confirmEnrollment} disabled={busy === 'mfa' || mfaCode.length !== 6}>
                      Confirm
                    </Button>
                    <Button onClick={() => setEnrollment(null)}>Cancel</Button>
                  </Stack>
                </Stack>
              ) : (
                <Stack spacing={2} alignItems="flex-start">
                  <Typography variant="body2" color="text.secondary">
                    Add a second factor so a stolen password alone cannot reach the console.
                  </Typography>
                  <Button variant="contained" startIcon={<SecurityIcon />} onClick={startEnrollment} disabled={busy === 'mfa'}>
                    Set up MFA
                  </Button>
                </Stack>
              )}

              {recoveryCodes && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    Save these recovery codes now — they are shown once.
                  </Typography>
                  <Box sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, columnCount: 2 }}>
                    {recoveryCodes.map((code) => (
                      <div key={code}>{code}</div>
                    ))}
                  </Box>
                </Alert>
              )}
            </GlassCard>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ProfilePage;
