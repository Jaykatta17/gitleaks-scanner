import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import InboxIcon from '@mui/icons-material/Inbox';

export const LoadingState = ({ label = 'Loading…', height = 220 }) => (
  <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ height }}>
    <CircularProgress size={26} />
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
  </Stack>
);

export const EmptyState = ({ title = 'Nothing here yet', description, action, icon }) => (
  <Stack alignItems="center" justifyContent="center" spacing={1.25} sx={{ py: 6, px: 2, textAlign: 'center' }}>
    <Box sx={{ color: 'text.disabled', display: 'grid', placeItems: 'center' }}>{icon || <InboxIcon fontSize="large" />}</Box>
    <Typography variant="h4">{title}</Typography>
    {description && (
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        {description}
      </Typography>
    )}
    {action}
  </Stack>
);

export const ErrorState = ({ error, onRetry }) => (
  <Alert
    severity="error"
    action={
      onRetry && (
        <Button color="inherit" size="small" onClick={onRetry}>
          Retry
        </Button>
      )
    }
    sx={{ my: 1 }}
  >
    {typeof error === 'string' ? error : error?.message || 'Request failed'}
  </Alert>
);
