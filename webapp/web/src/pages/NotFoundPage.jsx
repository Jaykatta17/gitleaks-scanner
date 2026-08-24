import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Container, Typography } from '@mui/material';
import { glass } from '../theme/tokens.js';

export const NotFoundPage = () => (
  <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
    <Container maxWidth="sm">
      <Box sx={{ ...glass({ radius: 20 }), p: 5, textAlign: 'center' }}>
        <Typography variant="h1" gutterBottom>
          404
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          That page does not exist, or your role cannot see it.
        </Typography>
        <Button component={RouterLink} to="/" variant="contained">
          Back to the dashboard
        </Button>
      </Box>
    </Container>
  </Box>
);

export default NotFoundPage;
