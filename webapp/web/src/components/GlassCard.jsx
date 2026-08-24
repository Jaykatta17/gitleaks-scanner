import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { glass } from '../theme/tokens.js';

/** The one frosted surface every panel in the app is built from. */
export const GlassCard = ({ title, subtitle, action, children, padding = 2.5, sx = {}, contentSx = {}, strong }) => (
  <Card sx={{ ...glass({ strong }), display: 'flex', flexDirection: 'column', ...sx }}>
    {(title || action) && (
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ px: padding, pt: padding, pb: subtitle ? 0.5 : 1 }}
      >
        <Box sx={{ minWidth: 0 }}>
          {title && (
            <Typography variant="h4" noWrap>
              {title}
            </Typography>
          )}
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Stack>
    )}
    <CardContent sx={{ p: padding, pt: title ? 1.5 : padding, '&:last-child': { pb: padding }, flex: 1, ...contentSx }}>
      {children}
    </CardContent>
  </Card>
);

export default GlassCard;
