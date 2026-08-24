import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader.jsx';
import GlassCard from '../components/GlassCard.jsx';
import SeverityChip from '../components/SeverityChip.jsx';
import { ErrorState } from '../components/States.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api, errorMessage, getAccessToken } from '../api/client.js';
import { findingStatusLabel, severityOrder } from '../theme/tokens.js';

const STATUS_COLOR = {
  open: 'error',
  triaged: 'warning',
  false_positive: 'default',
  remediated: 'success',
  accepted_risk: 'info',
};

export const FindingsPage = () => {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { can } = useAuth();
  const [selection, setSelection] = useState([]);
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });

  const filters = useMemo(
    () => ({
      severity: params.get('severity') || '',
      status: params.get('status') || '',
      applicationId: params.get('applicationId') || '',
      branch: params.get('branch') || '',
      scanId: params.get('scanId') || '',
      q: params.get('q') || '',
    }),
    [params],
  );

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing the application invalidates whatever branch was selected.
    if (key === 'applicationId') next.delete('branch');
    setParams(next, { replace: true });
    setPaginationModel((model) => ({ ...model, page: 0 }));
  };

  const { data, loading, error, reload } = useAsync(
    () =>
      api.findings({
        ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
        page: paginationModel.page + 1,
        limit: paginationModel.pageSize,
        sort: 'severity',
      }),
    [filters, paginationModel.page, paginationModel.pageSize],
  );

  const { data: applications } = useAsync(() => api.applications({ limit: 100 }), []);
  const selectedApplication = (applications?.items || []).find((item) => item._id === filters.applicationId);

  const updateStatus = async (status) => {
    try {
      await api.bulkFindings({ ids: selection.map(String), status, note: note || undefined });
      toast.success(`${selection.length} finding(s) marked ${findingStatusLabel[status]}`);
      setSelection([]);
      setNote('');
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const exportCsv = async () => {
    // The export endpoint needs the bearer token, so fetch and hand the blob to the browser.
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    try {
      const response = await fetch(`${api.exportFindingsUrl(Object.fromEntries(query))}`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `findings-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded — the export itself is audited');
    } catch (caught) {
      toast.error(caught.message);
    }
  };

  const columns = [
    {
      field: 'severity',
      headerName: 'Severity',
      width: 130,
      renderCell: ({ value }) => <SeverityChip severity={value} />,
      sortComparator: (a, b) => severityOrder.indexOf(a) - severityOrder.indexOf(b),
    },
    { field: 'applicationKey', headerName: 'Application', width: 120 },
    {
      field: 'branch',
      headerName: 'Branch',
      width: 150,
      renderCell: ({ value }) => <Chip size="small" variant="outlined" label={value || '—'} />,
    },
    { field: 'ruleId', headerName: 'Rule', width: 170 },
    {
      field: 'file',
      headerName: 'Location',
      flex: 1.4,
      minWidth: 240,
      renderCell: ({ row }) => (
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
          {row.file}:{row.startLine}
        </Typography>
      ),
    },
    {
      field: 'secretPreview',
      headerName: 'Secret (redacted)',
      width: 190,
      renderCell: ({ value }) => (
        <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', color: 'text.secondary' }} noWrap>
          {value || '—'}
        </Typography>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 150,
      renderCell: ({ value }) => <Chip size="small" label={findingStatusLabel[value] || value} color={STATUS_COLOR[value]} variant="outlined" />,
    },
    {
      field: 'firstSeenAt',
      headerName: 'First seen',
      width: 130,
      renderCell: ({ value }) => dayjs(value).format('DD MMM YYYY'),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Findings"
        description="Triage queue across every application and branch. Secrets are stored redacted — rotate the credential first, then remove it from history."
        actions={
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />

      <GlassCard padding={2}>
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              placeholder="Search file, rule or author"
              defaultValue={filters.q}
              onKeyDown={(event) => event.key === 'Enter' && setFilter('q', event.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField select fullWidth label="Severity" value={filters.severity} onChange={(event) => setFilter('severity', event.target.value)}>
              <MenuItem value="">All</MenuItem>
              {severityOrder.map((severity) => (
                <MenuItem key={severity} value={severity}>
                  {severity}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField select fullWidth label="Status" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
              <MenuItem value="">All</MenuItem>
              {Object.entries(findingStatusLabel).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              select
              fullWidth
              label="Application"
              value={filters.applicationId}
              onChange={(event) => setFilter('applicationId', event.target.value)}
            >
              <MenuItem value="">All applications</MenuItem>
              {(applications?.items || []).map((application) => (
                <MenuItem key={application._id} value={application._id}>
                  {application.key} — {application.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              select
              fullWidth
              label="Branch"
              value={filters.branch}
              onChange={(event) => setFilter('branch', event.target.value)}
              disabled={!selectedApplication}
            >
              <MenuItem value="">All branches</MenuItem>
              {(selectedApplication?.branches || []).map((branch) => (
                <MenuItem key={branch.name} value={branch.name}>
                  {branch.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} md={12}>
            {filters.scanId && <Chip label={`Scan ${filters.scanId}`} onDelete={() => setFilter('scanId', '')} />}
          </Grid>
        </Grid>

        {can('triageFindings') && selection.length > 0 && (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight={600}>
              {selection.length} selected
            </Typography>
            <TextField placeholder="Triage note (optional)" value={note} onChange={(event) => setNote(event.target.value)} sx={{ minWidth: 260 }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" variant="outlined" onClick={() => updateStatus('triaged')}>
                Mark triaged
              </Button>
              <Button size="small" variant="outlined" color="success" onClick={() => updateStatus('remediated')}>
                Remediated
              </Button>
              <Button size="small" variant="outlined" color="inherit" onClick={() => updateStatus('false_positive')}>
                False positive
              </Button>
              <Button size="small" variant="outlined" color="info" onClick={() => updateStatus('accepted_risk')}>
                Accept risk
              </Button>
            </Stack>
          </Stack>
        )}

        {error ? (
          <ErrorState error={errorMessage(error)} onRetry={reload} />
        ) : (
          <DataGrid
            autoHeight
            rows={data?.items || []}
            columns={columns}
            getRowId={(row) => row._id}
            loading={loading}
            checkboxSelection={can('triageFindings')}
            disableRowSelectionOnClick
            rowSelectionModel={selection}
            onRowSelectionModelChange={setSelection}
            onRowClick={(rowParams) => setDetail(rowParams.row)}
            paginationMode="server"
            rowCount={data?.total || 0}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[10, 25, 50, 100]}
            sx={{
              border: 'none',
              '& .MuiDataGrid-row': { cursor: 'pointer' },
              '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
            }}
          />
        )}
      </GlassCard>

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          <Stack direction="row" spacing={1.5} alignItems="center">
            {detail && <SeverityChip severity={detail.severity} />}
            <span>{detail?.ruleId}</span>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {detail && (
            <Stack spacing={1.5}>
              {[
                ['Application', detail.applicationKey],
                ['Branch', detail.branch],
                ['Scan', detail.scanId],
                ['Location', `${detail.file}:${detail.startLine}`],
                ['Commit', detail.commit || '—'],
                ['Author', detail.author ? `${detail.author} <${detail.authorEmail}>` : '—'],
                ['Secret (redacted)', detail.secretPreview || '—'],
                ['Match (redacted)', detail.matchPreview || '—'],
                ['Entropy', detail.entropy ? detail.entropy.toFixed(2) : '—'],
                ['First seen', dayjs(detail.firstSeenAt).format('DD MMM YYYY HH:mm')],
                ['Status', findingStatusLabel[detail.status] || detail.status],
                ['Triage note', detail.triage?.note || '—'],
              ].map(([label, value]) => (
                <Box key={label}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all', fontWeight: 500 }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDetail(null)}>Close</Button>
          {can('triageFindings') && detail && (
            <Button
              variant="contained"
              onClick={async () => {
                try {
                  await api.updateFinding(detail._id, { status: 'remediated' });
                  toast.success('Marked remediated');
                  setDetail(null);
                  await reload();
                } catch (caught) {
                  toast.error(errorMessage(caught));
                }
              }}
            >
              Mark remediated
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default FindingsPage;
