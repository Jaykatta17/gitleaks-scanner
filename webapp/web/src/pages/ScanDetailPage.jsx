import { useEffect } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import StopIcon from '@mui/icons-material/StopCircle';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader.jsx';
import GlassCard from '../components/GlassCard.jsx';
import StatTile from '../components/StatTile.jsx';
import SeverityChip from '../components/SeverityChip.jsx';
import { SeverityBarChart } from '../components/charts.jsx';
import { LoadingState, ErrorState, EmptyState } from '../components/States.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api, errorMessage } from '../api/client.js';
import { scanStatusColor } from '../theme/tokens.js';

export const ScanDetailPage = () => {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.scan(scanId), [scanId]);
  const scan = data?.scan;
  const inFlight = scan?.status === 'queued' || scan?.status === 'running';

  useEffect(() => {
    // Poll only while the job is actually moving.
    if (!inFlight) return undefined;
    const timer = setInterval(() => void reload().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [inFlight, reload]);

  const cancel = async () => {
    try {
      await api.cancelScan(scanId);
      toast.info('Scan cancelled');
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const retry = async () => {
    try {
      const { scan: next } = await api.retryScan(scanId);
      toast.success(`Requeued as ${next.scanId}`);
      navigate(`/scans/${next.scanId}`);
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  if (loading && !data) return <LoadingState label="Loading scan…" />;
  if (error) return <ErrorState error={errorMessage(error)} onRetry={reload} />;
  if (!scan) return <EmptyState title="Scan not found" />;

  return (
    <Box>
      <PageHeader
        breadcrumbs={[{ label: 'Scans', to: '/scans' }, { label: scan.scanId }]}
        title={`${scan.projectKey} · ${scan.branch}`}
        description={`${scan.repoUrl}${scan.commitId ? ` @ ${scan.commitId}` : ''}`}
        actions={
          <>
            <Chip label={scan.status} color={scanStatusColor[scan.status]} />
            {can('runScans') && inFlight && (
              <Button variant="outlined" color="inherit" startIcon={<StopIcon />} onClick={cancel}>
                Cancel
              </Button>
            )}
            {can('runScans') && !inFlight && (
              <Button variant="contained" startIcon={<ReplayIcon />} onClick={retry}>
                Run again
              </Button>
            )}
          </>
        }
      />

      {inFlight && <LinearProgress sx={{ mb: 2.5 }} />}

      <Grid container spacing={2.5}>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Findings" value={scan.summary?.total ?? 0} caption={`${scan.summary?.critical ?? 0} critical`} tone="error" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Files scanned" value={scan.summary?.filesScanned ?? 0} caption={`${scan.summary?.commitsScanned ?? 0} commits`} tone="info" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Duration" value={scan.durationMs ? `${Math.round(scan.durationMs / 1000)}s` : '—'} caption={`driver: ${scan.driver}`} />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Requested by" value={scan.requestedByName || 'system'} caption={`${scan.trigger} · ${dayjs(scan.queuedAt).format('DD MMM HH:mm')}`} tone="success" />
        </Grid>

        <Grid item xs={12} lg={4}>
          <GlassCard title="Severity breakdown">
            <SeverityBarChart counts={data?.breakdown || {}} height={200} />
          </GlassCard>
        </Grid>

        <Grid item xs={12} lg={8}>
          <GlassCard
            title="Findings"
            subtitle={`${data?.findings?.length || 0} shown`}
            action={
              <Button component={RouterLink} to={`/findings?scanId=${scan.scanId}`} size="small">
                Open in triage
              </Button>
            }
          >
            {scan.error?.message && (
              <Box sx={{ mb: 2 }}>
                <ErrorState error={`${scan.error.stage || 'scan'}: ${scan.error.message}`} />
              </Box>
            )}
            <List dense disablePadding sx={{ maxHeight: 420, overflow: 'auto' }}>
              {(data?.findings || []).map((finding) => (
                <ListItem
                  key={finding._id}
                  disableGutters
                  component={RouterLink}
                  to={`/findings?scanId=${scan.scanId}&q=${encodeURIComponent(finding.file)}`}
                  sx={{ px: 1, borderRadius: 2, color: 'inherit', '&:hover': { background: 'rgba(11,11,11,0.04)' } }}
                  secondaryAction={<SeverityChip severity={finding.severity} />}
                >
                  <ListItemText
                    primary={`${finding.file}:${finding.startLine}`}
                    secondary={`${finding.ruleId} · ${finding.secretPreview || 'redacted'}`}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 600, sx: { wordBreak: 'break-all' } }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              ))}
              {!data?.findings?.length && (
                <EmptyState
                  title={scan.status === 'completed' ? 'No secrets found' : 'No findings yet'}
                  description={scan.status === 'completed' ? 'This revision is clean.' : 'Findings appear once the worker finishes.'}
                />
              )}
            </List>
          </GlassCard>
        </Grid>

        <Grid item xs={12}>
          <GlassCard title="Execution log" subtitle="Worker progress, newest last">
            <Box
              sx={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12.5,
                maxHeight: 280,
                overflow: 'auto',
                background: 'rgba(11,11,11,0.03)',
                borderRadius: 2,
                p: 1.5,
              }}
            >
              {(scan.logs || []).map((entry, index) => (
                <Stack key={`${entry.at}-${index}`} direction="row" spacing={1.5}>
                  <Typography component="span" variant="inherit" color="text.disabled">
                    {dayjs(entry.at).format('HH:mm:ss')}
                  </Typography>
                  <Typography component="span" variant="inherit" color={entry.level === 'error' ? 'error.main' : 'text.primary'}>
                    {entry.message}
                  </Typography>
                </Stack>
              ))}
              {!scan.logs?.length && <Typography variant="caption">No log entries.</Typography>}
            </Box>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary">
              Job id {scan.jobId || '—'} · attempt {scan.attempts || 1}
            </Typography>
          </GlassCard>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ScanDetailPage;
