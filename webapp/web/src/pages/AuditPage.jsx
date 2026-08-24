import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
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
import SendIcon from '@mui/icons-material/Send';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader.jsx';
import GlassCard from '../components/GlassCard.jsx';
import StatTile from '../components/StatTile.jsx';
import { ErrorState } from '../components/States.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api, errorMessage, getAccessToken } from '../api/client.js';

const OUTCOME_COLOR = { success: 'success', failure: 'error', denied: 'warning' };

export const AuditPage = () => {
  const toast = useToast();
  const { can } = useAuth();
  const [filters, setFilters] = useState({ q: '', action: '', category: '', outcome: '', from: '', to: '' });
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 50 });
  const [detail, setDetail] = useState(null);

  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
  const { data, loading, error, reload } = useAsync(
    () => api.auditLogs({ ...activeFilters, page: paginationModel.page + 1, limit: paginationModel.pageSize }),
    [JSON.stringify(activeFilters), paginationModel.page, paginationModel.pageSize],
  );
  const { data: facets } = useAsync(() => api.auditFacets(), []);
  const { data: syslog, reload: reloadSyslog } = useAsync(() => api.syslogStatus(), []);

  const setFilter = (key, value) => {
    setFilters((state) => ({ ...state, [key]: value }));
    setPaginationModel((model) => ({ ...model, page: 0 }));
  };

  const exportCsv = async () => {
    try {
      const query = new URLSearchParams(activeFilters);
      const response = await fetch(`/api/v1/audit-logs/export?${query}`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Audit export downloaded');
    } catch (caught) {
      toast.error(caught.message);
    }
  };

  const probeSyslog = async () => {
    try {
      const result = await api.testSyslog();
      toast[result.sent ? 'success' : 'warning'](
        result.sent ? `Probe sent to ${result.stats.target}` : 'Syslog forwarding is disabled — the event was stored only',
      );
      await reloadSyslog();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const columns = [
    {
      field: 'createdAt',
      headerName: 'When',
      width: 170,
      renderCell: ({ value }) => (
        <Stack>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {dayjs(value).format('DD MMM HH:mm:ss')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {dayjs(value).format('YYYY')}
          </Typography>
        </Stack>
      ),
    },
    { field: 'action', headerName: 'Action', width: 220 },
    { field: 'category', headerName: 'Category', width: 150 },
    {
      field: 'outcome',
      headerName: 'Outcome',
      width: 120,
      renderCell: ({ value }) => <Chip size="small" label={value} color={OUTCOME_COLOR[value]} variant={value === 'success' ? 'outlined' : 'filled'} />,
    },
    {
      field: 'actor',
      headerName: 'Actor',
      width: 160,
      valueGetter: (_value, row) => row.actor?.username,
      renderCell: ({ row }) => (
        <Stack>
          <Typography variant="body2" fontWeight={600}>
            {row.actor?.username}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {row.actor?.role || '—'}
          </Typography>
        </Stack>
      ),
    },
    { field: 'message', headerName: 'Detail', flex: 1.6, minWidth: 260 },
    {
      field: 'forwardedToSyslog',
      headerName: 'Syslog',
      width: 100,
      renderCell: ({ value }) => <Chip size="small" label={value ? 'sent' : 'stored'} variant="outlined" color={value ? 'success' : 'default'} />,
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Audit trail"
        description="Every authentication, authorisation and configuration event, persisted in MongoDB and mirrored to syslog."
        actions={
          <>
            {can('editSettings') && (
              <Button variant="outlined" startIcon={<SendIcon />} onClick={probeSyslog}>
                Send syslog probe
              </Button>
            )}
            <Button variant="contained" startIcon={<DownloadIcon />} onClick={exportCsv}>
              Export evidence
            </Button>
          </>
        }
      />

      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Records retained" value={syslog?.persisted ?? '—'} caption={`${syslog?.retentionDays ?? 0} day retention`} />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Forwarded" value={syslog?.forwarded ?? '—'} caption={syslog?.enabled ? syslog.target : 'forwarding disabled'} tone="success" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Not forwarded" value={syslog?.unforwarded ?? '—'} caption={syslog?.lastError || 'no collector errors'} tone="warning" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatTile label="Format" value={syslog?.rfc ? `RFC ${syslog.rfc}` : '—'} caption={`facility ${syslog?.facility ?? '—'}`} tone="info" />
        </Grid>
      </Grid>

      <GlassCard padding={2}>
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              placeholder="Search message, actor or IP"
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
          <Grid item xs={6} md={2.5}>
            <TextField select fullWidth label="Action" value={filters.action} onChange={(event) => setFilter('action', event.target.value)}>
              <MenuItem value="">All actions</MenuItem>
              {(facets?.actions || []).map((action) => (
                <MenuItem key={action} value={action}>
                  {action}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField select fullWidth label="Category" value={filters.category} onChange={(event) => setFilter('category', event.target.value)}>
              <MenuItem value="">All</MenuItem>
              {(facets?.categories || []).map((category) => (
                <MenuItem key={category} value={category}>
                  {category}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} md={1.5}>
            <TextField select fullWidth label="Outcome" value={filters.outcome} onChange={(event) => setFilter('outcome', event.target.value)}>
              <MenuItem value="">All</MenuItem>
              <MenuItem value="success">Success</MenuItem>
              <MenuItem value="failure">Failure</MenuItem>
              <MenuItem value="denied">Denied</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={6} md={1.5}>
            <TextField fullWidth type="date" label="From" InputLabelProps={{ shrink: true }} value={filters.from} onChange={(event) => setFilter('from', event.target.value)} />
          </Grid>
          <Grid item xs={6} md={1.5}>
            <TextField fullWidth type="date" label="To" InputLabelProps={{ shrink: true }} value={filters.to} onChange={(event) => setFilter('to', event.target.value)} />
          </Grid>
        </Grid>

        {error ? (
          <ErrorState error={errorMessage(error)} onRetry={reload} />
        ) : (
          <DataGrid
            autoHeight
            rows={data?.items || []}
            columns={columns}
            getRowId={(row) => row._id}
            loading={loading}
            paginationMode="server"
            rowCount={data?.total || 0}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[25, 50, 100]}
            disableRowSelectionOnClick
            onRowClick={(params) => setDetail(params.row)}
            sx={{
              border: 'none',
              '& .MuiDataGrid-row': { cursor: 'pointer' },
              '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
            }}
          />
        )}
      </GlassCard>

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} fullWidth maxWidth="sm">
        <DialogTitle>{detail?.action}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {detail &&
              [
                ['Event id', detail.eventId],
                ['When', dayjs(detail.createdAt).format('DD MMM YYYY HH:mm:ss')],
                ['Outcome', detail.outcome],
                ['Severity', detail.severity],
                ['Actor', `${detail.actor?.username} (${detail.actor?.role || 'n/a'}, ${detail.actor?.authProvider || 'n/a'})`],
                ['Target', detail.target?.type ? `${detail.target.type} ${detail.target.name || detail.target.id}` : '—'],
                ['Source IP', detail.context?.ip || '—'],
                ['Request', `${detail.context?.method || ''} ${detail.context?.path || ''} → ${detail.context?.statusCode ?? '—'}`],
                ['Correlation id', detail.context?.requestId || '—'],
                ['Forwarded to syslog', detail.forwardedToSyslog ? 'yes' : 'no'],
                ['Message', detail.message],
              ].map(([label, value]) => (
                <Box key={label}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word', fontWeight: 500 }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            {detail?.metadata && Object.keys(detail.metadata).length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Metadata (sensitive values redacted at write time)
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    mt: 0.5,
                    p: 1.5,
                    borderRadius: 2,
                    background: 'rgba(11,11,11,0.05)',
                    fontSize: 12,
                    overflow: 'auto',
                    maxHeight: 240,
                  }}
                >
                  {JSON.stringify(detail.metadata, null, 2)}
                </Box>
              </Box>
            )}
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default AuditPage;
