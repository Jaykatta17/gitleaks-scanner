import { useState } from 'react';
import { Box, Button, Chip, Divider, Grid, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import MailIcon from '@mui/icons-material/MarkEmailRead';
import DnsIcon from '@mui/icons-material/Dns';
import PageHeader from '../components/PageHeader.jsx';
import GlassCard from '../components/GlassCard.jsx';
import { LoadingState, ErrorState } from '../components/States.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useToast } from '../components/Toast.jsx';
import { api, errorMessage } from '../api/client.js';

const StatusChip = ({ ok, onLabel = 'enabled', offLabel = 'disabled' }) => (
  <Chip size="small" color={ok ? 'success' : 'default'} variant={ok ? 'filled' : 'outlined'} label={ok ? onLabel : offLabel} />
);

const DefinitionList = ({ rows }) => (
  <List dense disablePadding>
    {rows.map(([label, value]) => (
      <ListItem key={label} disableGutters>
        <ListItemText
          primary={label}
          secondary={String(value ?? '—')}
          primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
          secondaryTypographyProps={{ variant: 'body2', color: 'text.primary', sx: { wordBreak: 'break-word' } }}
        />
      </ListItem>
    ))}
  </List>
);

export const SettingsPage = () => {
  const toast = useToast();
  const [testEmail, setTestEmail] = useState('');
  const [busy, setBusy] = useState(null);
  const { data: config, loading, error, reload } = useAsync(() => api.config(), []);
  const { data: health, reload: reloadHealth } = useAsync(() => api.health(), []);

  const sendTestEmail = async () => {
    setBusy('smtp');
    try {
      const result = await api.testSmtp(testEmail.trim());
      toast[result.simulated ? 'info' : 'success'](
        result.simulated ? 'SMTP is disabled — the message was rendered and logged only' : `Test message sent to ${testEmail}`,
      );
      await reloadHealth();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const testDirectory = async () => {
    setBusy('ldap');
    try {
      const result = await api.testLdap();
      toast[result.ok ? 'success' : 'error'](result.ok ? `Directory reachable in ${result.latencyMs}ms` : result.message || 'Directory unreachable');
      await reloadHealth();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !config) return <LoadingState label="Reading platform configuration…" />;
  if (error) return <ErrorState error={errorMessage(error)} onRetry={reload} />;

  return (
    <Box>
      <PageHeader
        title="Platform settings"
        description="Effective configuration for authentication, mail, audit forwarding and the scan engine. Secrets stay in the environment and are never displayed here."
      />

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <GlassCard
            title="Directory (LDAP)"
            subtitle="Corporate sign-in and role mapping"
            action={
              <Stack direction="row" spacing={1} alignItems="center">
                <StatusChip ok={config?.auth?.ldapEnabled} />
                <Button size="small" startIcon={<DnsIcon />} onClick={testDirectory} disabled={busy === 'ldap' || !config?.auth?.ldapEnabled}>
                  Test
                </Button>
              </Stack>
            }
          >
            <DefinitionList
              rows={[
                ['Server', config?.auth?.ldapUrl || 'not configured'],
                ['Search base', config?.auth?.ldapSearchBase || '—'],
                ['Group role mappings', (config?.auth?.ldapRoleMappings || []).join('\n') || 'none — everyone gets the default role'],
                ['Live check', health?.ldap?.ok ? `reachable (${health.ldap.latencyMs}ms)` : health?.ldap?.message || 'not checked'],
              ]}
            />
          </GlassCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <GlassCard
            title="Mail relay (SMTP)"
            subtitle="Notification delivery"
            action={<StatusChip ok={config?.smtp?.enabled} />}
          >
            <DefinitionList
              rows={[
                ['Host', `${config?.smtp?.host}:${config?.smtp?.port}`],
                ['TLS', config?.smtp?.secure ? 'implicit (SMTPS)' : 'STARTTLS / plain'],
                ['Authenticated', config?.smtp?.authenticated ? 'yes' : 'no'],
                ['From', config?.smtp?.from],
                ['Live check', health?.smtp?.ok ? 'relay reachable' : health?.smtp?.message || 'not checked'],
              ]}
            />
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                size="small"
                type="email"
                label="Send a test message to"
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
              />
              <Button variant="outlined" startIcon={<MailIcon />} onClick={sendTestEmail} disabled={busy === 'smtp' || !testEmail}>
                Send
              </Button>
            </Stack>
          </GlassCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <GlassCard title="Audit forwarding (syslog)" subtitle="SIEM integration" action={<StatusChip ok={config?.syslog?.enabled} />}>
            <DefinitionList
              rows={[
                ['Collector', `${config?.syslog?.protocol}://${config?.syslog?.host}:${config?.syslog?.port}`],
                ['Format', `RFC ${config?.syslog?.rfc}`],
                ['Facility', config?.syslog?.facility],
                ['Retention', `${config?.syslog?.retentionDays} days in MongoDB`],
                ['Records sent this process', health?.syslog?.sent ?? 0],
                ['Records dropped', health?.syslog?.dropped ?? 0],
                ['Last error', health?.syslog?.lastError || 'none'],
              ]}
            />
          </GlassCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <GlassCard title="Authentication policy" subtitle="Applies to local accounts">
            <DefinitionList
              rows={[
                ['Minimum password length', config?.auth?.passwordMinLength],
                ['Password history', `${config?.auth?.passwordHistory} previous passwords blocked`],
                ['Lockout', `${config?.auth?.maxFailedLogins} failures → ${config?.auth?.lockoutMinutes} minutes`],
                ['MFA mandatory for admins', config?.auth?.requireMfaForAdmins ? 'yes' : 'no'],
                ['Access token lifetime', config?.auth?.accessTokenTtl],
                ['Refresh token lifetime', `${config?.auth?.refreshTokenDays} days (rotating)`],
              ]}
            />
          </GlassCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <GlassCard title="Scan engine" subtitle="How repositories are scanned">
            <DefinitionList
              rows={[
                ['Driver', config?.scanner?.driver],
                ['Gitleaks image', config?.scanner?.image],
                ['Clone depth', config?.scanner?.cloneDepth],
                ['Timeout', `${Math.round((config?.scanner?.timeoutMs || 0) / 60000)} minutes`],
                ['Secret redaction', config?.scanner?.redactSecrets ? 'enabled' : 'disabled'],
                ['Scan concurrency', config?.queue?.scanConcurrency],
                ['Job attempts', config?.queue?.attempts],
              ]}
            />
          </GlassCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <GlassCard title="Runtime" subtitle="Live service health" action={<Button size="small" onClick={reloadHealth}>Refresh</Button>}>
            <DefinitionList
              rows={[
                ['Service', `${health?.app?.name} ${health?.app?.version} (${health?.app?.env})`],
                ['Node', health?.app?.node],
                ['Host', health?.app?.host],
                ['Uptime', `${Math.round((health?.app?.uptimeSeconds || 0) / 60)} minutes`],
                ['Memory', `${health?.app?.memoryMb ?? '—'} MB`],
                ['MongoDB', `${health?.mongo?.status} (${health?.mongo?.db || 'n/a'})`],
                ['Redis', `${health?.redis?.status}${health?.redis?.latencyMs != null ? ` (${health.redis.latencyMs}ms)` : ''}`],
              ]}
            />
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary">
              Queue depths
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
              {Object.entries(health?.queues || {}).map(([name, counts]) => (
                <Chip key={name} size="small" variant="outlined" label={`${name}: ${counts?.waiting ?? 0} waiting / ${counts?.active ?? 0} active`} />
              ))}
            </Stack>
          </GlassCard>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SettingsPage;
