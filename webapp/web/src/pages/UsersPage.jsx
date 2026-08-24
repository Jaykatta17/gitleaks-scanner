import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import KeyIcon from '@mui/icons-material/VpnKey';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader.jsx';
import GlassCard from '../components/GlassCard.jsx';
import { ErrorState } from '../components/States.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api, errorMessage } from '../api/client.js';
import { roleLabel } from '../theme/tokens.js';

const ROLES = ['admin', 'security_analyst', 'developer', 'viewer'];
const STATUS_COLOR = { active: 'success', disabled: 'default', pending: 'warning' };

const emptyUser = {
  username: '',
  email: '',
  displayName: '',
  department: '',
  role: 'viewer',
  authProvider: 'local',
  password: '',
  sendWelcomeEmail: true,
};

export const UsersPage = () => {
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyUser);
  const [saving, setSaving] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [roleFilter, setRoleFilter] = useState('');

  const { data, loading, error, reload } = useAsync(() => api.users({ role: roleFilter || undefined, limit: 100 }), [roleFilter]);

  const createUser = async () => {
    setSaving(true);
    try {
      await api.createUser({
        ...form,
        username: form.username.trim().toLowerCase(),
        email: form.email.trim().toLowerCase(),
        password: form.authProvider === 'local' ? form.password : undefined,
      });
      toast.success(`Account ${form.username} created`);
      setDialogOpen(false);
      setForm(emptyUser);
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not create the account'));
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (id, role) => {
    try {
      await api.updateUser(id, { role });
      toast.success('Role updated — the change is in the audit trail');
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const toggleStatus = async (row) => {
    try {
      await api.updateUser(row._id, { status: row.status === 'active' ? 'disabled' : 'active' });
      toast.success(`Account ${row.status === 'active' ? 'disabled' : 'enabled'}`);
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const columns = [
    {
      field: 'displayName',
      headerName: 'Name',
      flex: 1.2,
      minWidth: 180,
      renderCell: ({ row }) => (
        <Stack sx={{ py: 0.5 }}>
          <Typography variant="body2" fontWeight={600}>
            {row.displayName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {row.username} · {row.email}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'role',
      headerName: 'Role',
      width: 190,
      renderCell: ({ row }) => (
        <TextField
          select
          size="small"
          value={row.role}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => changeRole(row._id, event.target.value)}
          disabled={row._id === currentUser?._id}
          sx={{ minWidth: 168 }}
        >
          {ROLES.map((role) => (
            <MenuItem key={role} value={role}>
              {roleLabel[role]}
            </MenuItem>
          ))}
        </TextField>
      ),
    },
    {
      field: 'authProvider',
      headerName: 'Source',
      width: 110,
      renderCell: ({ value }) => <Chip size="small" label={value === 'ldap' ? 'Directory' : 'Local'} variant="outlined" />,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 130,
      renderCell: ({ row }) => (
        <Chip
          size="small"
          label={row.lockedUntil && dayjs(row.lockedUntil).isAfter(dayjs()) ? 'locked' : row.status}
          color={row.lockedUntil && dayjs(row.lockedUntil).isAfter(dayjs()) ? 'error' : STATUS_COLOR[row.status]}
          onClick={(event) => {
            event.stopPropagation();
            toggleStatus(row);
          }}
        />
      ),
    },
    {
      field: 'mfa',
      headerName: 'MFA',
      width: 90,
      renderCell: ({ row }) => (row.mfa?.enabled ? <Chip size="small" color="success" label="on" /> : <Chip size="small" label="off" variant="outlined" />),
    },
    {
      field: 'lastLoginAt',
      headerName: 'Last sign-in',
      width: 160,
      renderCell: ({ value }) => (value ? dayjs(value).format('DD MMM HH:mm') : 'never'),
    },
    {
      field: 'actions',
      headerName: '',
      width: 130,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Issue a temporary password">
            <span>
              <IconButton
                size="small"
                disabled={row.authProvider !== 'local'}
                onClick={async (event) => {
                  event.stopPropagation();
                  try {
                    const result = await api.resetUserPassword(row._id);
                    setTemporaryPassword({ username: row.username, password: result.temporaryPassword });
                  } catch (caught) {
                    toast.error(errorMessage(caught));
                  }
                }}
              >
                <KeyIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Unlock account">
            <IconButton
              size="small"
              onClick={async (event) => {
                event.stopPropagation();
                try {
                  await api.unlockUser(row._id);
                  toast.success('Account unlocked');
                  await reload();
                } catch (caught) {
                  toast.error(errorMessage(caught));
                }
              }}
            >
              <LockOpenIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete account">
            <span>
              <IconButton
                size="small"
                color="error"
                disabled={row._id === currentUser?._id}
                onClick={(event) => {
                  event.stopPropagation();
                  setConfirmDelete(row);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Users & access"
        description="Local and directory accounts, their roles, and the state of their multi-factor enrolment."
        actions={
          <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setDialogOpen(true)}>
            New account
          </Button>
        }
      />

      <GlassCard padding={2}>
        <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
          <TextField select label="Role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">All roles</MenuItem>
            {ROLES.map((role) => (
              <MenuItem key={role} value={role}>
                {roleLabel[role]}
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
            getRowId={(row) => row._id}
            loading={loading}
            rowHeight={62}
            disableRowSelectionOnClick
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            pageSizeOptions={[10, 25, 50]}
            sx={{ border: 'none', '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' } }}
          />
        )}
      </GlassCard>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create an account</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ pt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Username" required value={form.username} onChange={(event) => setForm((state) => ({ ...state, username: event.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth type="email" label="Email" required value={form.email} onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Display name" required value={form.displayName} onChange={(event) => setForm((state) => ({ ...state, displayName: event.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Department" value={form.department} onChange={(event) => setForm((state) => ({ ...state, department: event.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField select fullWidth label="Role" value={form.role} onChange={(event) => setForm((state) => ({ ...state, role: event.target.value }))}>
                {ROLES.map((role) => (
                  <MenuItem key={role} value={role}>
                    {roleLabel[role]}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField select fullWidth label="Sign-in method" value={form.authProvider} onChange={(event) => setForm((state) => ({ ...state, authProvider: event.target.value }))}>
                <MenuItem value="local">Local password</MenuItem>
                <MenuItem value="ldap">Corporate directory</MenuItem>
              </TextField>
            </Grid>
            {form.authProvider === 'local' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  type="password"
                  label="Initial password"
                  required
                  value={form.password}
                  onChange={(event) => setForm((state) => ({ ...state, password: event.target.value }))}
                  helperText="At least 12 characters using three character classes. The user must change it at first sign-in."
                />
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={createUser} disabled={saving || !form.username || !form.email || !form.displayName}>
            {saving ? 'Creating…' : 'Create account'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(temporaryPassword)} onClose={() => setTemporaryPassword(null)} fullWidth maxWidth="xs">
        <DialogTitle>Temporary password</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Share this with {temporaryPassword?.username} over a trusted channel. It is shown once and must be changed at
            first sign-in.
          </DialogContentText>
          <Box sx={{ p: 1.5, borderRadius: 2, background: 'rgba(11,11,11,0.05)', fontFamily: 'ui-monospace, monospace' }}>
            {temporaryPassword?.password}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemporaryPassword(null)}>Done</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {confirmDelete?.username}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The account is removed and all of its sessions are revoked. Audit records naming this user are retained.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              try {
                await api.deleteUser(confirmDelete._id);
                toast.success('Account deleted');
                setConfirmDelete(null);
                await reload();
              } catch (caught) {
                toast.error(errorMessage(caught));
              }
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UsersPage;
