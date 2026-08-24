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
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import PlayIcon from '@mui/icons-material/PlayArrow';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
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
const PROVIDERS = ['github', 'gitlab', 'bitbucket', 'azure_devops', 'gitea', 'other'];
const ENVIRONMENTS = ['production', 'staging', 'development', 'release', 'feature', 'other'];
const CRITICALITY_COLOR = { critical: 'error', high: 'warning', medium: 'info', low: 'default' };

const emptyHod = { name: '', email: '' };
const emptySpoc = { name: '', email: '', employeeId: '', designation: '', department: '', phone: '' };

const emptyForm = {
  key: '',
  name: '',
  applicationId: '',
  description: '',
  businessUnit: '',
  criticality: 'medium',
  assessmentType: 'internal',
  tags: '',
  hod: { ...emptyHod },
  spoc: { ...emptySpoc },
  useBackupSpoc: false,
  backupSpoc: { ...emptySpoc },
  repository: { url: '', provider: 'github', defaultBranch: 'main', visibility: 'private', credentialRef: '' },
  branches: [{ name: 'main', environment: 'production', isDefault: true, scanEnabled: true }],
};

const STEPS = ['Application', 'Ownership', 'Repository & branches'];

/**
 * Contact block. The head of department is recorded as a name and an inbox;
 * the SPOC (and backup) carry the working details as well.
 */
const ContactFields = ({ value, onChange, label, required, detailed = true, hint }) => (
  <Box>
    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, textTransform: 'uppercase' }}>
      {label}
    </Typography>
    <Grid container spacing={2}>
      <Grid item xs={12} sm={6}>
        <TextField
          fullWidth
          label="Full name"
          required={required}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          fullWidth
          type="email"
          label="Email"
          required={required}
          value={value.email}
          onChange={(event) => onChange({ ...value, email: event.target.value })}
        />
      </Grid>
      {detailed && (
        <>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              label="Employee ID"
              value={value.employeeId}
              onChange={(event) => onChange({ ...value, employeeId: event.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              label="Designation"
              value={value.designation}
              onChange={(event) => onChange({ ...value, designation: event.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              label="Phone"
              value={value.phone}
              onChange={(event) => onChange({ ...value, phone: event.target.value })}
            />
          </Grid>
        </>
      )}
    </Grid>
    {hint && (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {hint}
      </Typography>
    )}
  </Box>
);

export const ApplicationsPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [criticality, setCriticality] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selection, setSelection] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const { data, loading, error, reload } = useAsync(
    () =>
      api.applications({
        q: query || undefined,
        criticality: criticality || undefined,
        archived: String(showArchived),
        limit: 100,
      }),
    [query, criticality, showArchived],
  );

  const setBranch = (index, patch) =>
    setForm((state) => ({
      ...state,
      branches: state.branches.map((branch, position) =>
        position === index
          ? { ...branch, ...patch }
          : patch.isDefault
            ? { ...branch, isDefault: false }
            : branch,
      ),
    }));

  const stepComplete = (index) => {
    if (index === 0) return form.key.trim().length >= 2 && form.name.trim().length >= 2;
    if (index === 1) return Boolean(form.hod.name && form.hod.email && form.spoc.name && form.spoc.email);
    return Boolean(form.repository.url) && form.branches.some((branch) => branch.name.trim());
  };

  const submit = async () => {
    setSaving(true);
    try {
      const branches = form.branches
        .filter((branch) => branch.name.trim())
        .map((branch) => ({ ...branch, name: branch.name.trim() }));
      const { application } = await api.createApplication({
        key: form.key.trim(),
        name: form.name.trim(),
        applicationId: form.applicationId.trim(),
        description: form.description.trim(),
        businessUnit: form.businessUnit.trim(),
        criticality: form.criticality,
        assessmentType: form.assessmentType,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        hod: form.hod,
        spoc: form.spoc,
        ...(form.useBackupSpoc && form.backupSpoc.email ? { backupSpoc: form.backupSpoc } : {}),
        repository: { ...form.repository, url: form.repository.url.trim() },
        branches,
      });
      toast.success(`${application.key} registered with ${application.branches.length} branch(es)`);
      setDialogOpen(false);
      setStep(0);
      setForm(emptyForm);
      await reload();
      navigate(`/applications/${application._id}`);
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not register the application'));
    } finally {
      setSaving(false);
    }
  };

  const scanSelected = async () => {
    try {
      const { results } = await api.bulkScan({ applicationIds: selection.map(String) });
      toast.success(`${results.filter((result) => result.status === 'queued').length} scan(s) queued`);
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
      renderCell: ({ row }) => (
        <Stack sx={{ py: 0.5 }}>
          <Typography variant="body2" fontWeight={700}>
            {row.key}
          </Typography>
          {row.applicationId && (
            <Typography variant="caption" color="text.secondary">
              {row.applicationId}
            </Typography>
          )}
        </Stack>
      ),
    },
    {
      field: 'name',
      headerName: 'Application',
      flex: 1.3,
      minWidth: 200,
      renderCell: ({ row }) => (
        <Stack sx={{ py: 0.5 }}>
          <Typography variant="body2" fontWeight={600}>
            {row.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {row.businessUnit || '—'}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'hod',
      headerName: 'HOD',
      flex: 1,
      minWidth: 170,
      valueGetter: (_value, row) => row.hod?.name,
      renderCell: ({ row }) => (
        <Stack sx={{ py: 0.5 }}>
          <Typography variant="body2">{row.hod?.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {row.hod?.email}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'spoc',
      headerName: 'SPOC',
      flex: 1,
      minWidth: 170,
      valueGetter: (_value, row) => row.spoc?.name,
      renderCell: ({ row }) => (
        <Stack sx={{ py: 0.5 }}>
          <Typography variant="body2">{row.spoc?.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {row.spoc?.email}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'branches',
      headerName: 'Branches',
      width: 120,
      valueGetter: (_value, row) => row.branches?.length || 0,
      renderCell: ({ row }) => (
        <Tooltip title={(row.branches || []).map((branch) => branch.name).join(', ') || 'none'}>
          <Chip size="small" icon={<AccountTreeIcon sx={{ fontSize: 15 }} />} label={row.branches?.length || 0} variant="outlined" />
        </Tooltip>
      ),
    },
    {
      field: 'criticality',
      headerName: 'Criticality',
      width: 120,
      renderCell: ({ value }) => <Chip size="small" label={value} color={CRITICALITY_COLOR[value]} variant="outlined" />,
    },
    {
      field: 'openFindings',
      headerName: 'Open',
      width: 120,
      valueGetter: (_value, row) => row.stats?.openFindings ?? 0,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="body2" fontWeight={600}>
            {row.stats?.openFindings ?? 0}
          </Typography>
          {row.stats?.criticalFindings > 0 && (
            <Chip
              size="small"
              label={row.stats.criticalFindings}
              sx={{ background: `${palette.severity.critical}22`, color: palette.severity.critical }}
            />
          )}
        </Stack>
      ),
    },
    {
      field: 'lastScanAt',
      headerName: 'Last scan',
      width: 150,
      valueGetter: (_value, row) => row.stats?.lastScanAt,
      renderCell: ({ row }) =>
        row.stats?.lastScanAt ? (
          <Stack sx={{ py: 0.5 }}>
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
        title="Applications"
        description="Registered applications with their head of department, single point of contact and git repository. Each application can be scanned on as many branches as it has."
        actions={
          <>
            {can('runScans') && selection.length > 0 && (
              <Button variant="outlined" startIcon={<PlayIcon />} onClick={scanSelected}>
                Scan {selection.length} selected
              </Button>
            )}
            {can('manageApplications') && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
                Register application
              </Button>
            )}
          </>
        }
      />

      <GlassCard padding={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <TextField
            placeholder="Search name, key, repository, HOD or SPOC"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ minWidth: 320 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <TextField
            select
            label="Criticality"
            value={criticality}
            onChange={(event) => setCriticality(event.target.value)}
            sx={{ minWidth: 160 }}
          >
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
            rowHeight={62}
            checkboxSelection={can('runScans')}
            disableRowSelectionOnClick
            onRowSelectionModelChange={setSelection}
            rowSelectionModel={selection}
            onRowClick={(params) => navigate(`/applications/${params.id}`)}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            pageSizeOptions={[10, 25, 50, 100]}
            sx={{
              border: 'none',
              '& .MuiDataGrid-row': { cursor: 'pointer' },
              '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
            }}
          />
        )}
      </GlassCard>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Register an application</DialogTitle>
        <DialogContent dividers>
          <Stepper activeStep={step} sx={{ mb: 3 }}>
            {STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {step === 0 && (
            <Grid container spacing={2}>
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
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Application name"
                  required
                  value={form.name}
                  onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  fullWidth
                  label="Inventory ID"
                  value={form.applicationId}
                  onChange={(event) => setForm((state) => ({ ...state, applicationId: event.target.value }))}
                  helperText="CMDB reference"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Business unit"
                  value={form.businessUnit}
                  onChange={(event) => setForm((state) => ({ ...state, businessUnit: event.target.value }))}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  fullWidth
                  label="Criticality"
                  value={form.criticality}
                  onChange={(event) => setForm((state) => ({ ...state, criticality: event.target.value }))}
                >
                  {CRITICALITIES.map((level) => (
                    <MenuItem key={level} value={level}>
                      {level}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select
                  fullWidth
                  label="Assessment type"
                  value={form.assessmentType}
                  onChange={(event) => setForm((state) => ({ ...state, assessmentType: event.target.value }))}
                >
                  {ASSESSMENTS.map((type) => (
                    <MenuItem key={type} value={type}>
                      {type.replace('_', ' ')}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Tags"
                  placeholder="pci, tier-1"
                  value={form.tags}
                  onChange={(event) => setForm((state) => ({ ...state, tags: event.target.value }))}
                  helperText="Comma separated"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  label="Description"
                  value={form.description}
                  onChange={(event) => setForm((state) => ({ ...state, description: event.target.value }))}
                />
              </Grid>
            </Grid>
          )}

          {step === 1 && (
            <Stack spacing={3}>
              <ContactFields
                required
                detailed={false}
                label="Head of department"
                hint="Recorded for accountability and copied on notifications."
                value={form.hod}
                onChange={(hod) => setForm((state) => ({ ...state, hod }))}
              />
              <Divider />
              <ContactFields
                required
                label="SPOC (single point of contact)"
                value={form.spoc}
                onChange={(spoc) => setForm((state) => ({ ...state, spoc }))}
              />
              <Divider />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.useBackupSpoc}
                    onChange={(event) => setForm((state) => ({ ...state, useBackupSpoc: event.target.checked }))}
                  />
                }
                label="Add a backup SPOC"
              />
              {form.useBackupSpoc && (
                <ContactFields
                  label="Backup SPOC"
                  value={form.backupSpoc}
                  onChange={(backupSpoc) => setForm((state) => ({ ...state, backupSpoc }))}
                />
              )}
              <Typography variant="caption" color="text.secondary">
                The SPOC receives scan results and critical-finding alerts; the head of department is copied.
              </Typography>
            </Stack>
          )}

          {step === 2 && (
            <Stack spacing={2.5}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={8}>
                  <TextField
                    fullWidth
                    label="Repository URL"
                    required
                    placeholder="https://github.com/acme/service.git"
                    value={form.repository.url}
                    onChange={(event) =>
                      setForm((state) => ({ ...state, repository: { ...state.repository, url: event.target.value } }))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    select
                    fullWidth
                    label="Provider"
                    value={form.repository.provider}
                    onChange={(event) =>
                      setForm((state) => ({ ...state, repository: { ...state.repository, provider: event.target.value } }))
                    }
                  >
                    {PROVIDERS.map((provider) => (
                      <MenuItem key={provider} value={provider}>
                        {provider.replace('_', ' ')}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    select
                    fullWidth
                    label="Visibility"
                    value={form.repository.visibility}
                    onChange={(event) =>
                      setForm((state) => ({
                        ...state,
                        repository: { ...state.repository, visibility: event.target.value },
                      }))
                    }
                  >
                    {['private', 'internal', 'public'].map((value) => (
                      <MenuItem key={value} value={value}>
                        {value}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={8}>
                  <TextField
                    fullWidth
                    label="Credential reference"
                    value={form.repository.credentialRef}
                    onChange={(event) =>
                      setForm((state) => ({
                        ...state,
                        repository: { ...state.repository, credentialRef: event.target.value },
                      }))
                    }
                    helperText="Name of the vault entry — never paste the token itself"
                  />
                </Grid>
              </Grid>

              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, textTransform: 'uppercase' }}>
                  Branches to scan
                </Typography>
                <Stack spacing={1.5}>
                  {form.branches.map((branch, index) => (
                    <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                      <TextField
                        label="Branch"
                        value={branch.name}
                        onChange={(event) => setBranch(index, { name: event.target.value })}
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        select
                        label="Environment"
                        value={branch.environment}
                        onChange={(event) => setBranch(index, { environment: event.target.value })}
                        sx={{ minWidth: 160 }}
                      >
                        {ENVIRONMENTS.map((environment) => (
                          <MenuItem key={environment} value={environment}>
                            {environment}
                          </MenuItem>
                        ))}
                      </TextField>
                      <FormControlLabel
                        control={
                          <Checkbox checked={Boolean(branch.isDefault)} onChange={() => setBranch(index, { isDefault: true })} />
                        }
                        label="Default"
                      />
                      <IconButton
                        size="small"
                        color="error"
                        disabled={form.branches.length === 1}
                        onClick={() =>
                          setForm((state) => ({ ...state, branches: state.branches.filter((_, position) => position !== index) }))
                        }
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  sx={{ mt: 1 }}
                  onClick={() =>
                    setForm((state) => ({
                      ...state,
                      branches: [...state.branches, { name: '', environment: 'other', isDefault: false, scanEnabled: true }],
                    }))
                  }
                >
                  Add another branch
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  You can scan each branch independently, and add more branches later.
                </Typography>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Box sx={{ flex: 1 }} />
          {step > 0 && <Button onClick={() => setStep((current) => current - 1)}>Back</Button>}
          {step < STEPS.length - 1 ? (
            <Button variant="contained" disabled={!stepComplete(step)} onClick={() => setStep((current) => current + 1)}>
              Next
            </Button>
          ) : (
            <Button variant="contained" onClick={submit} disabled={saving || !stepComplete(2)}>
              {saving ? 'Registering…' : 'Register application'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ApplicationsPage;
