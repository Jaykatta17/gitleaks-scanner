import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import PageHeader from '../components/PageHeader.jsx';
import GlassCard from '../components/GlassCard.jsx';
import { ErrorState } from '../components/States.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api, errorMessage } from '../api/client.js';
import { scanStatusColor, palette } from '../theme/tokens.js';

dayjs.extend(relativeTime);

const STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];

export const ScansPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });

  const { data, loading, error, reload } = useAsync(
    () => api.scans({ status: status || undefined, page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt' }),
    [status, paginationModel.page, paginationModel.pageSize],
  );

  const columns = [
    {
      field: 'scanId',
      headerName: 'Scan',
      width: 210,
      renderCell: ({ value }) => (
        <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
      ),
    },
    { field: 'projectKey', headerName: 'Project', width: 120 },
    { field: 'branch', headerName: 'Branch', width: 140 },
    {
      field: 'status',
      headerName: 'Status',
      width: 130,
      renderCell: ({ value }) => <Chip size="small" label={value} color={scanStatusColor[value]} variant={value === 'completed' ? 'outlined' : 'filled'} />,
    },
    {
      field: 'findings',
      headerName: 'Findings',
      width: 160,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="body2" fontWeight={600}>
            {row.summary?.total ?? 0}
          </Typography>
          {row.summary?.critical > 0 && (
            <Chip size="small" label={`${row.summary.critical} critical`} sx={{ background: `${palette.severity.critical}22`, color: palette.severity.critical }} />
          )}
        </Stack>
      ),
    },
    { field: 'trigger', headerName: 'Trigger', width: 110 },
    { field: 'requestedByName', headerName: 'Requested by', width: 150 },
    {
      field: 'createdAt',
      headerName: 'Queued',
      width: 170,
      renderCell: ({ value }) => (
        <Stack>
          <Typography variant="body2">{dayjs(value).format('DD MMM HH:mm')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {dayjs(value).fromNow()}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'durationMs',
      headerName: 'Duration',
      width: 110,
      renderCell: ({ value }) => (value ? `${Math.round(value / 1000)}s` : '—'),
    },
  ];

  return (
    <Box>
      <PageHeader title="Scans" description="Every queued, running and completed scan, newest first." />

      <GlassCard padding={2}>
        <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
          <TextField select label="Status" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All statuses</MenuItem>
            {STATUSES.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {error ? (
          <ErrorState error={errorMessage(error)} onRetry={reload} />
        ) : (
          <DataGrid
            autoHeight
            rows={data?.items || []}
            columns={columns}
            getRowId={(row) => row.scanId}
            loading={loading}
            paginationMode="server"
            rowCount={data?.total || 0}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[10, 25, 50, 100]}
            disableRowSelectionOnClick
            onRowClick={(params) => navigate(`/scans/${params.id}`)}
            sx={{
              border: 'none',
              '& .MuiDataGrid-row': { cursor: 'pointer' },
              '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
            }}
          />
        )}
      </GlassCard>
    </Box>
  );
};

export default ScansPage;
