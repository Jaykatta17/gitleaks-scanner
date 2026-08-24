import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
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
  TextField,
  Typography,
} from '@mui/material';
import PlayIcon from '@mui/icons-material/PlayArrow';
import ArchiveIcon from '@mui/icons-material/Inventory2';
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

export const ProjectDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [branch, setBranch] = useState('');
  const [commitId, setCommitId] = useState('');
  const [queueing, setQueueing] = useState(false);

  const { data, loading, error, reload } = useAsync(() => api.project(id), [id]);
  const { data: stats } = useAsync(() => api.projectStats(id), [id]);
  const project = data?.project;

  const queueScan = async () => {
    setQueueing(true);
    try {
      const { scan } = await api.createScan({
        projectId: id,
        branch: branch.trim() || undefined,
        commitId: commitId.trim() || '',
      });
      toast.success(`Scan ${scan.scanId} queued`);
      navigate(`/scans/${scan.scanId}`);
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not queue the scan'));
    } finally {
      setQueueing(false);
    }
  };

  const archive = async () => {
    try {
      await api.archiveProject(id);
      toast.success('Project archived — scan history is retained');
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  if (loading && !data) return <LoadingState label="Loading project…" />;
  if (error) return <ErrorState error={errorMessage(error)} onRetry={reload} />;
  if (!project) return <EmptyState title="Project not found" />;

  return (
    <Box>
      <PageHeader
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: project.key }]}
        title={project.name}
        description={project.description || project.repoUrl}
        actions={
          can('manageProjects') && !project.archived ? (
            <Button variant="outlined" color="inherit" startIcon={<ArchiveIcon />} onClick={archive}>
              Archive
            </Button>
          ) : null
        }
      />

      <Grid container spacing={2.5}>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Open findings" value={project.stats?.openFindings ?? 0} caption={`${project.stats?.criticalFindings ?? 0} critical`} tone="error" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Total scans" value={project.stats?.totalScans ?? 0} caption={project.stats?.lastScanStatus || 'never scanned'} />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Criticality" value={project.criticality} caption={project.businessUnit || 'No business unit'} tone="warning" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile
            label="Last scan"
            value={project.stats?.lastScanAt ? dayjs(project.stats.lastScanAt).format('DD MMM') : '—'}
            caption={project.stats?.lastScanAt ? dayjs(project.stats.lastScanAt).format('HH:mm') : 'No scan recorded'}
            tone="info"
          />
        </Grid>

        <Grid item xs={12} md={6} lg={4}>
          <GlassCard title="Repository" subtitle="Scan target configuration">
            <List dense disablePadding>
              {[
                ['Repository', project.repoUrl],
                ['Default branch', project.defaultBranch],
                ['Maintainer', project.maintainerEmail],
                ['Assessment', project.assessmentType?.replace('_', ' ')],
                ['Credential reference', project.credentialRef || 'none (public or agent-provided)'],
                ['Schedule', project.schedule?.enabled ? `enabled (${project.schedule.cron})` : 'manual only'],
              ].map(([label, value]) => (
                <ListItem key={label} disableGutters>
                  <ListItemText
                    primary={label}
                    secondary={value}
                    primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
                    secondaryTypographyProps={{ variant: 'body2', color: 'text.primary', sx: { wordBreak: 'break-all' } }}
                  />
                </ListItem>
              ))}
            </List>
            {project.tags?.length > 0 && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {project.tags.map((tag) => (
                    <Chip key={tag} size="small" label={tag} variant="outlined" />
                  ))}
                </Stack>
              </>
            )}
          </GlassCard>
        </Grid>

        <Grid item xs={12} md={6} lg={4}>
          <GlassCard title="Open findings by severity">
            <SeverityBarChart counts={data?.severityBreakdown || {}} height={200} />
            <Button component={RouterLink} to={`/findings?projectId=${project._id}`} size="small" sx={{ mt: 1 }}>
              Review findings
            </Button>
          </GlassCard>
        </Grid>

        <Grid item xs={12} lg={4}>
          <GlassCard title="Run a scan" subtitle="Queued through Redis and picked up by a worker">
            {can('runScans') ? (
              <Stack spacing={2}>
                <TextField label="Branch" placeholder={project.defaultBranch} value={branch} onChange={(event) => setBranch(event.target.value)} />
                <TextField label="Commit (optional)" placeholder="HEAD" value={commitId} onChange={(event) => setCommitId(event.target.value)} helperText="Hex sha; leave blank to scan the branch head" />
                <Button variant="contained" startIcon={<PlayIcon />} onClick={queueScan} disabled={queueing || project.archived}>
                  {queueing ? 'Queueing…' : 'Queue scan'}
                </Button>
                {project.archived && (
                  <Typography variant="caption" color="text.secondary">
                    This project is archived; unarchive it to run new scans.
                  </Typography>
                )}
              </Stack>
            ) : (
              <EmptyState title="Read-only access" description="Your role cannot queue scans." />
            )}
          </GlassCard>
        </Grid>

        <Grid item xs={12} lg={7}>
          <GlassCard title="Recent scans">
            <List dense disablePadding>
              {(data?.recentScans || []).map((scan) => (
                <ListItem
                  key={scan.scanId}
                  disableGutters
                  component={RouterLink}
                  to={`/scans/${scan.scanId}`}
                  sx={{ px: 1, borderRadius: 2, color: 'inherit', '&:hover': { background: 'rgba(11,11,11,0.04)' } }}
                  secondaryAction={<Chip size="small" label={scan.status} variant="outlined" />}
                >
                  <ListItemText
                    primary={`${scan.scanId} · ${scan.branch}`}
                    secondary={`${scan.summary?.total ?? 0} findings · ${dayjs(scan.createdAt).format('DD MMM HH:mm')}`}
                    primaryTypographyProps={{ fontWeight: 600, fontSize: '0.88rem' }}
                  />
                </ListItem>
              ))}
              {!data?.recentScans?.length && <EmptyState title="No scans yet" description="Queue the first scan for this project." />}
            </List>
          </GlassCard>
        </Grid>

        <Grid item xs={12} lg={5}>
          <GlassCard title="Most frequent rules" subtitle="Across open findings">
            <List dense disablePadding>
              {(stats?.topRules || []).map((rule) => (
                <ListItem key={rule.ruleId} disableGutters secondaryAction={<Chip size="small" label={rule.count} />}>
                  <ListItemText primary={rule.ruleId} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
                </ListItem>
              ))}
              {!stats?.topRules?.length && <EmptyState title="No open findings" />}
            </List>
            {data?.severityBreakdown?.critical > 0 && (
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center">
                <SeverityChip severity="critical" />
                <Typography variant="body2" color="text.secondary">
                  Rotate the affected credentials before remediating the code.
                </Typography>
              </Stack>
            )}
          </GlassCard>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ProjectDetailPage;
