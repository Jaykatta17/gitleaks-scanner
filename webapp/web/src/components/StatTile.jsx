import { Box, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import GlassCard from './GlassCard.jsx';

/**
 * A single headline number. No plot, so no hover layer — the value is the whole
 * message and the caption carries the qualifier.
 */
export const StatTile = ({ label, value, caption, icon, tone = 'primary', loading }) => (
  <GlassCard padding={2.25} sx={{ height: '100%' }}>
    <Stack direction="row" spacing={2} alignItems="flex-start">
      {icon && (
        <Box
          sx={(theme) => ({
            width: 44,
            height: 44,
            borderRadius: 3,
            display: 'grid',
            placeItems: 'center',
            color: theme.palette[tone]?.main ?? theme.palette.primary.main,
            background: alpha(theme.palette[tone]?.main ?? theme.palette.primary.main, 0.12),
            flexShrink: 0,
          })}
        >
          {icon}
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4 }}>
          {label}
        </Typography>
        {loading ? (
          <Skeleton width={72} height={40} />
        ) : (
          <Typography variant="h2" sx={{ lineHeight: 1.15 }}>
            {value}
          </Typography>
        )}
        {caption && (
          <Typography variant="body2" color="text.secondary" noWrap>
            {caption}
          </Typography>
        )}
      </Box>
    </Stack>
  </GlassCard>
);

export default StatTile;
