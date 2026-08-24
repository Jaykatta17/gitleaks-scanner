import { Chip, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { palette, severityLabel } from '../theme/tokens.js';

// Status colour never travels alone: each severity ships with its icon and label.
const ICONS = {
  critical: ErrorIcon,
  high: WarningIcon,
  medium: InfoIcon,
  low: CheckCircleIcon,
};

export const SeverityChip = ({ severity, size = 'small', variant = 'chip' }) => {
  const color = palette.severity[severity] || palette.ink.muted;
  const Icon = ICONS[severity] || InfoIcon;
  const label = severityLabel[severity] || severity;

  if (variant === 'inline') {
    return (
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Icon sx={{ fontSize: 16, color }} />
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
      </Stack>
    );
  }

  return (
    <Chip
      size={size}
      icon={<Icon sx={{ fontSize: 16, color: `${color} !important` }} />}
      label={label}
      sx={{
        color,
        backgroundColor: alpha(color, 0.14),
        border: `1px solid ${alpha(color, 0.35)}`,
        '& .MuiChip-label': { fontWeight: 600 },
      }}
    />
  );
};

export default SeverityChip;
