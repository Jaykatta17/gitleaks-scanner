import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import BugReportIcon from '@mui/icons-material/BugReport';
import FolderIcon from '@mui/icons-material/FolderSpecial';
import RadarIcon from '@mui/icons-material/Radar';
import TimerIcon from '@mui/icons-material/Timer';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import PageHeader from '../components/PageHeader.jsx';
import GlassCard from '../components/GlassCard.jsx';
import StatTile from '../components/StatTile.jsx';
import SeverityChip from '../components/SeverityChip.jsx';
import { LoadingState, ErrorState, EmptyState } from '../components/States.jsx';
import { FindingsTrendChart, SeverityBarChart, TopProjectsChart, ScanVolumeChart } from '../components/charts.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api, errorMessage } from '../api/client.js';
import { palette } from '../theme/tokens.js';

dayjs.extend(relativeTime);

const OUTCOME_COLOR = { success: 'default', failure: 'error', denied: 'warning' };

export const DashboardPage = () => {
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useAsync(() => api.dashboard({ days }), [days]);
  const { data: activity } = useAsync(() => api.activity({ limit: 12 }), []);

  const trend = useMemo(
    () =>
      (data?.trend || []).map((point) => ({
        date: point.date,
        findings: point.findings,
        critical: point.critical,
        succeeded: point.scans - point.failed,
        failed: point.failed,
      })),
    [data],
  );

  if (loading && !data) return <LoadingState label="Building your security overview…" height={420} />;
  if (error) return <ErrorState error={errorMessage(error)} onRetry={reload} />;

  const severity = data?.findings?.openBySeverity || {};
  const scans = data?.scans?.byStatus || {};

  return (
    <Box>
      <PageHeader
        title="Security overview"
        description="Open exposure across every onboarded repository, and how the scanning pipeline is behaving."
        actions={
          <ToggleButtonGroup
            exclusive
            size="small"
            value={days}
            onChange={(_event, value) => value && setDays(value)}
            aria-label="Time window"
          >
            <ToggleButton value={7}>7 days</ToggleButton>
            <ToggleButton value={30}>30 days</ToggleButton>
            <ToggleButton value={90}>90 days</ToggleButton>
          </ToggleButtonGroup>
        }
      />

      <Grid container spacing={2.5}>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile
            label="Open findings"
            value={data?.findings?.openTotal ?? 0}
            caption={`${severity.critical || 0} critical · ${severity.high || 0} high`}
            icon={<BugReportIcon />}
            tone="error"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile
            label="Projects monitored"
            value={data?.projects?.active ?? 0}
            caption={`${data?.projects?.archived ?? 0} archived`}
            icon={<FolderIcon />}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile
            label="Scans in flight"
            value={(scans.queued || 0) + (scans.running || 0)}
            caption={`${scans.completed || 0} completed · ${scans.failed || 0} failed`}
            icon={<RadarIcon />}
            tone="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile
            label="Mean time to remediate"
            value={data?.findings?.meanTimeToRemediateHours != null ? `${data.findings.meanTimeToRemediateHours}h` : '—'}
            caption={`${data?.findings?.remediatedCount ?? 0} findings remediated`}
            icon={<TimerIcon />}
            tone="success"
          />
        </Grid>

        <Grid item xs={12} lg={8}>
          <GlassCard
            sx={{ height: '100%' }}
            title="Findings discovered"
            subtitle={`Per day across the last ${data?.windowDays ?? days} days`}
            action={
              <Button component={RouterLink} to="/findings" size="small">
                Open triage queue
              </Button>
            }
          >
            {trend.length ? <FindingsTrendChart data={trend} /> : <EmptyState title="No completed scans in this window" />}
          </GlassCard>
        </Grid>

        <Grid item xs={12} lg={4}>
          <GlassCard sx={{ height: '100%' }} title="Open by severity" subtitle="Findings still awaiting remediation">
            <SeverityBarChart counts={severity} />
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {Object.entries(data?.findings?.byStatus || {}).map(([status, count]) => (
                <Chip key={status} size="small" variant="outlined" label={`${status.replace('_', ' ')}: ${count}`} />
              ))}
            </Stack>
          </GlassCard>
        </Grid>

        <Grid item xs={12} lg={5}>
          <GlassCard sx={{ height: '100%' }} title="Most exposed projects" subtitle="Ranked by open findings">
            {data?.topProjects?.length ? (
              <TopProjectsChart data={data.topProjects} />
            ) : (
              <EmptyState title="No open findings" description="Every project is currently clean." />
            )}
          </GlassCard>
        </Grid>

        <Grid item xs={12} lg={7}>
          <GlassCard sx={{ height: '100%' }} title="Scan volume" subtitle="Completed and failed runs per day">
            {trend.length ? <ScanVolumeChart data={trend} /> : <EmptyState title="No scans in this window" />}
          </GlassCard>
        </Grid>

        <Grid item xs={12} lg={7}>
          <GlassCard
            sx={{ height: '100%' }}
            title="Recent scans"
            action={
              <Button component={RouterLink} to="/scans" size="small">
                All scans
              </Button>
            }
          >
            <List dense disablePadding>
              {(data?.scans?.recent || []).map((scan) => (
                <ListItem
                  key={scan.scanId}
                  disableGutters
                  component={RouterLink}
                  to={`/scans/${scan.scanId}`}
                  sx={{ borderRadius: 2, px: 1, '&:hover': { background: 'rgba(11,11,11,0.04)' }, color: 'inherit' }}
                  secondaryAction={
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      {scan.summary?.critical > 0 && <SeverityChip severity="critical" />}
                      <Chip size="small" label={scan.status} variant="outlined" />
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={`${scan.projectKey} · ${scan.branch}`}
                    secondary={`${scan.summary?.total ?? 0} finding(s) · ${dayjs(scan.createdAt).fromNow()}`}
                    primaryTypographyProps={{ fontWeight: 600, fontSize: '0.9rem' }}
                  />
                </ListItem>
              ))}
              {!data?.scans?.recent?.length && <EmptyState title="No scans yet" description="Queue one from a project." />}
            </List>
          </GlassCard>
        </Grid>

        <Grid item xs={12} lg={5}>
          <GlassCard sx={{ height: '100%' }} title="Audit activity" subtitle="Latest recorded platform events">
            <List dense disablePadding>
              {(activity?.events || []).map((event) => (
                <ListItem key={event._id} disableGutters sx={{ px: 1 }}>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {event.action}
                        </Typography>
                        {event.outcome !== 'success' && (
                          <Chip size="small" label={event.outcome} color={OUTCOME_COLOR[event.outcome]} />
                        )}
                      </Stack>
                    }
                    secondary={
                      <Tooltip title={dayjs(event.createdAt).format('DD MMM YYYY HH:mm:ss')}>
                        <span>{`${event.actor?.username || 'system'} · ${dayjs(event.createdAt).fromNow()}`}</span>
                      </Tooltip>
                    }
                  />
                </ListItem>
              ))}
              {!activity?.events?.length && <EmptyState title="No audit events yet" />}
            </List>
          </GlassCard>
        </Grid>

        <Grid item xs={12}>
          <GlassCard title="Queue health" subtitle="Redis-backed job queues">
            <Grid container spacing={2}>
              {Object.entries(data?.queues || {}).map(([name, counts]) => (
                <Grid item xs={12} md={4} key={name}>
                  <Box sx={{ p: 1.5, borderRadius: 3, border: `1px solid ${palette.surface.glassEdge}` }}>
                    <Typography variant="subtitle2" sx={{ textTransform: 'uppercase', color: 'text.secondary' }}>
                      {name}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                      {Object.entries(counts || {}).map(([state, count]) => (
                        <Chip
                          key={state}
                          size="small"
                          variant={state === 'failed' && count > 0 ? 'filled' : 'outlined'}
                          color={state === 'failed' && count > 0 ? 'error' : 'default'}
                          label={`${state}: ${count}`}
                        />
                      ))}
                    </Stack>
                  </Box>
                </Grid>
              ))}
              {!Object.keys(data?.queues || {}).length && (
                <Grid item xs={12}>
                  <EmptyState title="Queue metrics unavailable" description="Redis is not reachable from the API." />
                </Grid>
              )}
            </Grid>
          </GlassCard>
        </Grid>
      </Grid>
    </Box>
  );
};

export default DashboardPage;
