import { Box, Breadcrumbs, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export const PageHeader = ({ title, description, actions, breadcrumbs = [] }) => (
  <Stack
    direction={{ xs: 'column', md: 'row' }}
    justifyContent="space-between"
    alignItems={{ xs: 'flex-start', md: 'flex-end' }}
    spacing={2}
    sx={{ mb: 3 }}
  >
    <Box>
      {breadcrumbs.length > 0 && (
        <Breadcrumbs sx={{ mb: 0.5 }} separator="›">
          {breadcrumbs.map((crumb) =>
            crumb.to ? (
              <Link key={crumb.label} component={RouterLink} to={crumb.to} underline="hover" color="text.secondary" variant="body2">
                {crumb.label}
              </Link>
            ) : (
              <Typography key={crumb.label} variant="body2" color="text.primary">
                {crumb.label}
              </Typography>
            ),
          )}
        </Breadcrumbs>
      )}
      <Typography variant="h1">{title}</Typography>
      {description && (
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.75, maxWidth: 720 }}>
          {description}
        </Typography>
      )}
    </Box>
    {actions && (
      <Stack direction="row" spacing={1.5} flexWrap="wrap">
        {actions}
      </Stack>
    )}
  </Stack>
);

export default PageHeader;
