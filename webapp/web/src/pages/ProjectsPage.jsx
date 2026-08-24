import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import PlayIcon from '@mui/icons-material/PlayArrow';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader.jsx';
import GlassCard from '../components/GlassCard.jsx';
import { ErrorState } from '../components/States.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api, errorMessage } from '../api/client.js';
import { palette } from '../theme/tokens.js';

const CRITICALITIES = ['low', 'medium', 'high', 'critical'];
const ASSESSMENTS = ['internal', 'external', 'third_party', 'regulatory'];

const CRITICALITY_COLOR = { critical: 'error', high: 'warning', medium: 'info', low: 'default' };

const emptyProject = {
  key: '',
  name: '',
  repoUrl: '',
  defaultBranch: 'main',
  maintainerEmail: '',
  businessUnit: '',
  criticality: 'medium',
  assessmentType: 'internal',
  description: '',
  tags: '',
  scheduleEnabled: false,
};

export const ProjectsPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [criticality, setCriticality] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selection, setSelection] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyProject);
  const [saving, setSaving] = useState(false);

  const { data, loading, error, reload } = useAsync(
    () => api.projects({ q: query || undefined, criticality: criticality || undefined, archived: String(showArchived), limit: 100 }),
    [query, criticality, showArchived],
  );

  const submit = async () => {
    setSaving(true);
    try {
      await api.createProject({
        key: form.key.trim(),
        name: form.name.trim(),
        repoUrl: form.repoUrl.trim(),
        defaultBranch: form.defaultBranch.trim() || 'main',
        maintainerEmail: form.maintainerEmail.trim(),
        businessUnit: form.businessUnit.trim(),
        criticality: form.criticality,
        assessmentType: form.assessmentType,
        description: form.description.trim(),
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        schedule: { enabled: form.scheduleEnabled, cron: '0 3 * * *' },
      });
      toast.success(`Project ${form.key.toUpperCase()} onboarded`);
      setDialogOpen(false);
      setForm(emptyProject);
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not create the project'));
    } finally {
      setSaving(false);
    }
  };

  const scanSelected = async () => {
    try {
      const { results } = await api.bulkScan({ projectIds: selection.map(String) });
      const queued = results.filter((result) => result.status === 'queued').length;
      toast.success(`${queued} scan(s) queued`);
      setSelection([]);
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not queue the scans'));
    }
  };

  const columns = [
    {
      field: 'key',
      headerName: 'Key',
      width: 110,
      renderCell: ({ value }) => (
        <Typography variant="body2" fontWeight={700}>
          {value}
        </Typography>
      ),
    },
    { field: 'name', headerName: 'Project', flex: 1.4, minWidth: 200 },
    {
      field: 'repoUrl',
      headerName: 'Repository',
      flex: 1.6,
      minWidth: 220,
      renderCell: ({ value }) => (
        <Tooltip title={value}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {value}
          </Typography>
        </Tooltip>
      ),
    },
    {
      field: 'criticality',
      headerName: 'Criticality',
      width: 130,
      renderCell: ({ value }) => <Chip size="small" label={value} color={CRITICALITY_COLOR[value]} variant="outlined" />,
    },
    {
      field: 'openFindings',
      headerName: 'Open',
      width: 110,
      valueGetter: (_value, row) => row.stats?.openFindings ?? 0,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="body2" fontWeight={600}>
            {row.stats?.openFindings ?? 0}
          </Typography>
          {row.stats?.criticalFindings > 0 && (
            <Chip
              size="small"
              label={`${row.stats.criticalFindings} critical`}
              sx={{ background: `${palette.severity.critical}22`, color: palette.severity.critical }}
            />
          )}
        </Stack>
      ),
    },
    {
      field: 'lastScanAt',
      headerName: 'Last scan',
      width: 170,
      valueGetter: (_value, row) => row.stats?.lastScanAt,
      renderCell: ({ row }) =>
        row.stats?.lastScanAt ? (
          <Stack>
            <Typography variant="body2">{dayjs(row.stats.lastScanAt).format('DD MMM HH:mm')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {row.stats.lastScanStatus}
            </Typography>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            never
          </Typography>
        ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Projects"
        description="Repositories under continuous secret scanning, with ownership and business criticality."
        actions={
          <>
            {can('runScans') && selection.length > 0 && (
              <Button variant="outlined" startIcon={<PlayIcon />} onClick={scanSelected}>
                Scan {selection.length} selected
              </Button>
            )}
            {can('manageProjects') && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
                Onboard project
              </Button>
            )}
          </>
        }
      />

      <GlassCard padding={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <TextField
            placeholder="Search name, key or repository"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ minWidth: 280 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <TextField select label="Criticality" value={criticality} onChange={(event) => setCriticality(event.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">All</MenuItem>
            {CRITICALITIES.map((level) => (
              <MenuItem key={level} value={level}>
                {level}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Checkbox checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />}
            label="Archived"
          />
        </Stack>

        {error ? (
          <ErrorState error={errorMessage(error)} onRetry={reload} />
        ) : (
          <DataGrid
            autoHeight
            rows={data?.items || []}
            columns={columns}
            getRowId={(row) => row._id}
            loading={loading}
            checkboxSelection={can('runScans')}
            disableRowSelectionOnClick
            onRowSelectionModelChange={setSelection}
            rowSelectionModel={selection}
            onRowClick={(params) => navigate(`/projects/${params.id}`)}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            pageSizeOptions={[10, 25, 50, 100]}
            sx={{
              border: 'none',
              '& .MuiDataGrid-columnHeaders': { background: 'transparent' },
              '& .MuiDataGrid-row': { cursor: 'pointer' },
              '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
            }}
          />
        )}
      </GlassCard>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Onboard a repository</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ pt: 0.5 }}>
            <Grid item xs={12} sm={3}>
              <TextField
                fullWidth
                label="Key"
                required
                value={form.key}
                onChange={(event) => setForm((state) => ({ ...state, key: event.target.value.toUpperCase() }))}
                helperText="Short code, e.g. PAY"
              />
            </Grid>
            <Grid item xs={12} sm={9}>
              <TextField fullWidth label="Project name" required value={form.name} onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={8}>
              <TextField
                fullWidth
                label="Repository URL"
                required
                placeholder="https://github.com/acme/service.git"
                value={form.repoUrl}
                onChange={(event) => setForm((state) => ({ ...state, repoUrl: event.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Default branch" value={form.defaultBranch} onChange={(event) => setForm((state) => ({ ...state, defaultBranch: event.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth type="email" label="Maintainer email" required value={form.maintainerEmail} onChange={(event) => setForm((state) => ({ ...state, maintainerEmail: event.target.value }))} helperText="Receives scan and critical-finding notifications" />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Business unit" value={form.businessUnit} onChange={(event) => setForm((state) => ({ ...state, businessUnit: event.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField select fullWidth label="Criticality" value={form.criticality} onChange={(event) => setForm((state) => ({ ...state, criticality: event.target.value }))}>
                {CRITICALITIES.map((level) => (
                  <MenuItem key={level} value={level}>
                    {level}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField select fullWidth label="Assessment type" value={form.assessmentType} onChange={(event) => setForm((state) => ({ ...state, assessmentType: event.target.value }))}>
                {ASSESSMENTS.map((type) => (
                  <MenuItem key={type} value={type}>
                    {type.replace('_', ' ')}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Tags" placeholder="pci, tier-1" value={form.tags} onChange={(event) => setForm((state) => ({ ...state, tags: event.target.value }))} helperText="Comma separated" />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth multiline minRows={2} label="Description" value={form.description} onChange={(event) => setForm((state) => ({ ...state, description: event.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={<Checkbox checked={form.scheduleEnabled} onChange={(event) => setForm((state) => ({ ...state, scheduleEnabled: event.target.checked }))} />}
                label="Scan automatically every night at 03:00"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={saving || !form.key || !form.name || !form.repoUrl || !form.maintainerEmail}>
            {saving ? 'Saving…' : 'Onboard project'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProjectsPage;
