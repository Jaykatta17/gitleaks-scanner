import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import PlayIcon from '@mui/icons-material/PlayArrow';
import ArchiveIcon from '@mui/icons-material/Inventory2';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import LayersIcon from '@mui/icons-material/Layers';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
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
import { scanStatusColor, palette } from '../theme/tokens.js';

dayjs.extend(relativeTime);

const ENVIRONMENTS = ['production', 'staging', 'development', 'release', 'feature', 'other'];

const ContactCard = ({ title, contact, detailed = true }) => {
  if (!contact?.name) return null;
  const secondary = detailed ? [contact.employeeId, contact.phone].filter(Boolean).join(' · ') : '';
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {title}
      </Typography>
      <Typography variant="body1" fontWeight={600}>
        {contact.name}
      </Typography>
      {detailed && contact.designation && (
        <Typography variant="body2" color="text.secondary">
          {contact.designation}
        </Typography>
      )}
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        <a href={`mailto:${contact.email}`} style={{ color: palette.brand[600] }}>
          {contact.email}
        </a>
      </Typography>
      {secondary && (
        <Typography variant="body2" color="text.secondary">
          {secondary}
        </Typography>
      )}
    </Box>
  );
};

export const ApplicationDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [tab, setTab] = useState('branches');
  const [commitId, setCommitId] = useState('');
  const [busyBranch, setBusyBranch] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newBranch, setNewBranch] = useState({ name: '', environment: 'other', scanEnabled: true });
  const [confirmRemove, setConfirmRemove] = useState(null);

  const { data, loading, error, reload } = useAsync(() => api.application(id), [id]);
  const { data: branchData, reload: reloadBranches } = useAsync(() => api.branches(id), [id]);
  const { data: stats } = useAsync(() => api.applicationStats(id), [id]);
  const application = data?.application;

  const refresh = async () => {
    await Promise.all([reload(), reloadBranches()]);
  };

  const scanBranch = async (branch) => {
    setBusyBranch(branch);
    try {
      const { scan } = await api.createScan({ applicationId: id, branch, commitId: commitId.trim() || '' });
      toast.success(`Scan ${scan.scanId} queued for ${branch}`);
      navigate(`/scans/${scan.scanId}`);
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not queue the scan'));
    } finally {
      setBusyBranch(null);
    }
  };

  const scanAllBranches = async () => {
    setBusyBranch('__all__');
    try {
      const { results } = await api.bulkScan({ applicationId: id, allBranches: true });
      const queued = results.filter((result) => result.status === 'queued');
      toast.success(`${queued.length} branch scan(s) queued`);
      await refresh();
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not queue the scans'));
    } finally {
      setBusyBranch(null);
    }
  };

  const addBranch = async () => {
    try {
      await api.addBranch(id, { ...newBranch, name: newBranch.name.trim() });
      toast.success(`Branch ${newBranch.name} registered`);
      setAddOpen(false);
      setNewBranch({ name: '', environment: 'other', scanEnabled: true });
      await refresh();
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not add the branch'));
    }
  };

  const patchBranch = async (branch, payload, message) => {
    try {
      await api.updateBranch(id, branch, payload);
      toast.success(message);
      await refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const removeBranch = async () => {
    try {
      await api.removeBranch(id, confirmRemove);
      toast.info(`Stopped tracking ${confirmRemove}. Its scan history is retained.`);
      setConfirmRemove(null);
      await refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const archive = async () => {
    try {
      await api.archiveApplication(id);
      toast.success('Application archived — scan history is retained');
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  if (loading && !data) return <LoadingState label="Loading application…" />;
  if (error) return <ErrorState error={errorMessage(error)} onRetry={reload} />;
  if (!application) return <EmptyState title="Application not found" />;

  const branches = branchData?.branches || application.branches || [];
  const branchSeverity = data?.branchSeverity || {};

  return (
    <Box>
      <PageHeader
        breadcrumbs={[{ label: 'Applications', to: '/applications' }, { label: application.key }]}
        title={application.name}
        description={application.description || application.repository?.url}
        actions={
          <>
            {can('runScans') && !application.archived && (
              <Button
                variant="contained"
                startIcon={<LayersIcon />}
                onClick={scanAllBranches}
                disabled={busyBranch === '__all__'}
              >
                {busyBranch === '__all__' ? 'Queueing…' : 'Scan all branches'}
              </Button>
            )}
            {can('manageApplications') && !application.archived && (
              <Button variant="outlined" color="inherit" startIcon={<ArchiveIcon />} onClick={archive}>
                Archive
              </Button>
            )}
          </>
        }
      />

      <Grid container spacing={2.5} sx={{ mb: 1 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile
            label="Open findings"
            value={application.stats?.openFindings ?? 0}
            caption={`${application.stats?.criticalFindings ?? 0} critical`}
            tone="error"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile
            label="Branches tracked"
            value={branches.length}
            caption={`${branches.filter((branch) => branch.scanEnabled !== false).length} scannable`}
            tone="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile
            label="Total scans"
            value={application.stats?.totalScans ?? 0}
            caption={application.stats?.lastScanStatus || 'never scanned'}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile
            label="Criticality"
            value={application.criticality}
            caption={application.businessUnit || 'No business unit'}
            tone="warning"
          />
        </Grid>
      </Grid>

      <Tabs value={tab} onChange={(_event, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="branches" label={`Branches (${branches.length})`} />
        <Tab value="overview" label="Ownership & repository" />
        <Tab value="scans" label="Scan history" />
      </Tabs>

      {tab === 'branches' && (
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={8}>
            <GlassCard
              sx={{ height: '100%' }}
              title="Branches"
              subtitle="Each branch is scanned and tracked independently"
              action={
                can('manageApplications') && (
                  <Button size="small" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
                    Add branch
                  </Button>
                )
              }
            >
              {can('runScans') && (
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
                  <TextField
                    size="small"
                    label="Commit (optional)"
                    placeholder="HEAD"
                    value={commitId}
                    onChange={(event) => setCommitId(event.target.value)}
                    helperText="Applies to the next branch scan you launch"
                    sx={{ maxWidth: 260 }}
                  />
                </Stack>
              )}
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Branch</TableCell>
                      <TableCell>Environment</TableCell>
                      <TableCell align="right">Open</TableCell>
                      <TableCell>Last scan</TableCell>
                      <TableCell align="center">Scheduled</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {branches.map((branch) => (
                      <TableRow key={branch.name} hover>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Tooltip title={branch.isDefault ? 'Default branch' : 'Make default'}>
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={branch.isDefault || !can('manageApplications')}
                                  onClick={() => patchBranch(branch.name, { isDefault: true }, `${branch.name} is now the default branch`)}
                                >
                                  {branch.isDefault ? (
                                    <StarIcon fontSize="small" sx={{ color: palette.status.warning }} />
                                  ) : (
                                    <StarBorderIcon fontSize="small" />
                                  )}
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Typography variant="body2" fontWeight={600}>
                              {branch.name}
                            </Typography>
                            {branch.scanEnabled === false && <Chip size="small" label="paused" variant="outlined" />}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={branch.environment} variant="outlined" />
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                            <Typography variant="body2" fontWeight={600}>
                              {branch.stats?.openFindings ?? 0}
                            </Typography>
                            {branchSeverity[branch.name]?.critical > 0 && (
                              <Chip
                                size="small"
                                label={branchSeverity[branch.name].critical}
                                sx={{ background: `${palette.severity.critical}22`, color: palette.severity.critical }}
                              />
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          {branch.lastScan || branch.stats?.lastScanAt ? (
                            <Stack>
                              <Stack direction="row" spacing={0.75} alignItems="center">
                                <Chip
                                  size="small"
                                  label={branch.lastScan?.status || branch.stats?.lastScanStatus}
                                  color={scanStatusColor[branch.lastScan?.status || branch.stats?.lastScanStatus]}
                                  variant="outlined"
                                />
                                {branch.lastScan?.summary?.total != null && (
                                  <Typography variant="caption" color="text.secondary">
                                    {branch.lastScan.summary.total} finding(s)
                                  </Typography>
                                )}
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                {dayjs(branch.lastScan?.at || branch.stats?.lastScanAt).fromNow()} ·{' '}
                                {branch.scanCount ?? branch.stats?.totalScans ?? 0} scan(s)
                              </Typography>
                            </Stack>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              never scanned
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          <Switch
                            size="small"
                            checked={Boolean(branch.schedule?.enabled)}
                            disabled={!can('manageApplications')}
                            onChange={(event) =>
                              patchBranch(
                                branch.name,
                                { schedule: { enabled: event.target.checked, cron: branch.schedule?.cron || '0 3 * * *' } },
                                `Nightly scanning ${event.target.checked ? 'enabled' : 'disabled'} for ${branch.name}`,
                              )
                            }
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                            {can('runScans') && (
                              <Tooltip title={`Scan ${branch.name}`}>
                                <span>
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    disabled={busyBranch === branch.name || application.archived}
                                    onClick={() => scanBranch(branch.name)}
                                  >
                                    <PlayIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}
                            <Tooltip title="Findings on this branch">
                              <IconButton
                                size="small"
                                component={RouterLink}
                                to={`/findings?applicationId=${application._id}&branch=${encodeURIComponent(branch.name)}`}
                              >
                                <LayersIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            {can('manageApplications') && (
                              <Tooltip title={branch.isDefault ? 'The default branch cannot be removed' : 'Stop tracking'}>
                                <span>
                                  <IconButton
                                    size="small"
                                    color="error"
                                    disabled={branch.isDefault}
                                    onClick={() => setConfirmRemove(branch.name)}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!branches.length && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <EmptyState title="No branches registered" description="Add a branch to start scanning." />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </GlassCard>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Stack spacing={2.5}>
              <GlassCard title="Open findings by severity" subtitle="Across every branch">
                <SeverityBarChart counts={data?.severityBreakdown || {}} height={200} />
                <Button component={RouterLink} to={`/findings?applicationId=${application._id}`} size="small" sx={{ mt: 1 }}>
                  Review findings
                </Button>
              </GlassCard>

              <GlassCard title="Exposure per branch" subtitle="Open findings by branch">
                <List dense disablePadding>
                  {(stats?.branchExposure || []).map((row) => (
                    <ListItem
                      key={row.branch}
                      disableGutters
                      secondaryAction={
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          {row.critical > 0 && <SeverityChip severity="critical" />}
                          <Chip size="small" label={row.open} />
                        </Stack>
                      }
                    >
                      <ListItemText primary={row.branch} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
                    </ListItem>
                  ))}
                  {!stats?.branchExposure?.length && <EmptyState title="No open findings" />}
                </List>
              </GlassCard>
            </Stack>
          </Grid>
        </Grid>
      )}

      {tab === 'overview' && (
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={6}>
            <GlassCard sx={{ height: '100%' }} title="Ownership" subtitle="Accountable contacts for this application">
              <Stack spacing={2.5} divider={<Divider flexItem />}>
                <ContactCard title="Head of department" contact={application.hod} detailed={false} />
                <ContactCard title="SPOC" contact={application.spoc} />
                {application.backupSpoc?.email && <ContactCard title="Backup SPOC" contact={application.backupSpoc} />}
              </Stack>
            </GlassCard>
          </Grid>

          <Grid item xs={12} md={6}>
            <GlassCard sx={{ height: '100%' }} title="Repository" subtitle="Scan target configuration">
              <List dense disablePadding>
                {[
                  ['Repository', application.repository?.url],
                  ['Provider', application.repository?.provider],
                  ['Default branch', application.repository?.defaultBranch],
                  ['Visibility', application.repository?.visibility],
                  ['Credential reference', application.repository?.credentialRef || 'none (public or agent-provided)'],
                  ['Inventory ID', application.applicationId || '—'],
                  ['Assessment', application.assessmentType?.replace('_', ' ')],
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
              {application.tags?.length > 0 && (
                <>
                  <Divider sx={{ my: 1.5 }} />
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {application.tags.map((tag) => (
                      <Chip key={tag} size="small" label={tag} variant="outlined" />
                    ))}
                  </Stack>
                </>
              )}
            </GlassCard>
          </Grid>

          <Grid item xs={12}>
            <GlassCard title="Most frequent rules" subtitle="Across open findings on every branch">
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {(stats?.topRules || []).map((rule) => (
                  <Chip key={rule.ruleId} label={`${rule.ruleId} · ${rule.count}`} variant="outlined" />
                ))}
                {!stats?.topRules?.length && (
                  <Typography variant="body2" color="text.secondary">
                    No open findings.
                  </Typography>
                )}
              </Stack>
            </GlassCard>
          </Grid>
        </Grid>
      )}

      {tab === 'scans' && (
        <GlassCard title="Scan history" subtitle="Newest first, across every branch">
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Scan</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Findings</TableCell>
                  <TableCell>Trigger</TableCell>
                  <TableCell>Queued</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.recentScans || []).map((scan) => (
                  <TableRow
                    key={scan.scanId}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/scans/${scan.scanId}`)}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {scan.scanId}
                      </Typography>
                    </TableCell>
                    <TableCell>{scan.branch}</TableCell>
                    <TableCell>
                      <Chip size="small" label={scan.status} color={scanStatusColor[scan.status]} variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        <Typography variant="body2">{scan.summary?.total ?? 0}</Typography>
                        {scan.summary?.critical > 0 && (
                          <Chip
                            size="small"
                            label={scan.summary.critical}
                            sx={{ background: `${palette.severity.critical}22`, color: palette.severity.critical }}
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{scan.trigger}</TableCell>
                    <TableCell>{dayjs(scan.createdAt).format('DD MMM HH:mm')}</TableCell>
                  </TableRow>
                ))}
                {!data?.recentScans?.length && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState title="No scans yet" description="Launch one from the branches tab." />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Button component={RouterLink} to={`/scans?applicationId=${application._id}`} size="small" sx={{ mt: 1.5 }}>
            Open in the scan list
          </Button>
        </GlassCard>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add a branch</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <TextField
              autoFocus
              label="Branch name"
              placeholder="release/2.4"
              value={newBranch.name}
              onChange={(event) => setNewBranch((state) => ({ ...state, name: event.target.value }))}
            />
            <TextField
              select
              label="Environment"
              value={newBranch.environment}
              onChange={(event) => setNewBranch((state) => ({ ...state, environment: event.target.value }))}
            >
              {ENVIRONMENTS.map((environment) => (
                <MenuItem key={environment} value={environment}>
                  {environment}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={addBranch} disabled={!newBranch.name.trim()}>
            Add branch
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirmRemove)} onClose={() => setConfirmRemove(null)} fullWidth maxWidth="xs">
        <DialogTitle>Stop tracking {confirmRemove}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The branch is removed from this application. Scans and findings already recorded for it are kept, and the
            removal is written to the audit trail.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemove(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={removeBranch}>
            Stop tracking
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ApplicationDetailPage;
